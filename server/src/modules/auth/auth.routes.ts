import { Router, type CookieOptions } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isProduction } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { authenticate, currentUser, SESSION_COOKIE, signToken } from "../../middleware/auth";
import { validate } from "../../middleware/validate";

export const authRouter = Router();

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Password is required"),
});

const cookieOptions: CookieOptions = {
  httpOnly: true, // not readable by JS - protects the token from XSS
  sameSite: "lax",
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

// Slow down credential stuffing without affecting normal use.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many login attempts. Try again in a few minutes." } },
});

/** POST /api/auth/login */
authRouter.post("/login", loginLimiter, validate(LoginSchema), async (_req, res) => {
  const { email, password } = res.locals.body as z.infer<typeof LoginSchema>;

  const user = await prisma.user.findUnique({ where: { email }, include: { author: { select: { id: true } } } });
  // Same error for unknown email and wrong password - don't leak which emails exist.
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) throw new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password");

  const authUser = { id: user.id, role: user.role, name: user.name, authorId: user.author?.id ?? null };
  const token = signToken(authUser);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  // Token is also returned for API clients (Postman/curl) that can't use cookies.
  res.json({ user: { ...authUser, email: user.email }, token });
});

/** POST /api/auth/logout */
authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

/** GET /api/auth/me */
authRouter.get("/me", authenticate, async (req, res) => {
  const { id } = currentUser(req);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, author: { select: { id: true } } },
  });
  if (!user) throw new AppError(401, "UNAUTHORIZED", "Account no longer exists");
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, authorId: user.author?.id ?? null } });
});
