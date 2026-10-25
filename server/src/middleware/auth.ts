import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env";
import { forbidden, unauthorized } from "../lib/errors";
import type { AuthUser } from "../types/express";

export const SESSION_COOKIE = "bl_session";

interface TokenPayload {
  sub: string;
  role: Role;
  name: string;
  authorId: string | null;
}

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = { sub: user.id, role: user.role, name: user.name, authorId: user.authorId };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

/**
 * Reads the JWT from the httpOnly session cookie (browser) or from an
 * `Authorization: Bearer` header (API clients such as Postman / curl).
 * The cookie path is what lets the browser's EventSource authenticate the
 * real-time stream, which cannot send custom headers.
 */
function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === "string" && cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    req.user = { id: payload.sub, role: payload.role, name: payload.name, authorId: payload.authorId };
    next();
  } catch {
    next(unauthorized("Session expired or invalid. Please log in again."));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Narrowing helper for handlers that run after `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
