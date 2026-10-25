import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { aiStatus } from "./ai/llm";
import { env, isProduction, isServerless } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { adminRouter } from "./modules/admin/admin.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { booksRouter } from "./modules/books/books.routes";
import { ticketsRouter } from "./modules/tickets/tickets.routes";
import { eventsRouter } from "./realtime/events.routes";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // behind Render/Railway's proxy: correct client IP for rate limiting
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { "script-src": ["'self'", "'unsafe-inline'"] }, // swagger-ui init script
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // --- API ---
  app.get("/api/health", (_req, res) => {
    // Tells the client how to receive live updates: SSE on a long-lived
    // server, short-interval polling on serverless.
    res.json({ status: "ok", realtime: isServerless ? "poll" : "sse", ai: aiStatus() });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/books", booksRouter);
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/events", eventsRouter);

  // cwd is server/ locally and in Docker, the repo root on Vercel.
  const specPath = ["openapi.yaml", "server/openapi.yaml"].map((p) => path.resolve(process.cwd(), p)).find((p) => fs.existsSync(p));
  if (specPath) {
    const spec = YAML.parse(fs.readFileSync(specPath, "utf8"));
    app.get("/api/openapi.json", (_req, res) => res.json(spec));
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "BookLeaf Support API" }));
  }

  app.use("/api", notFoundHandler);

  // --- Frontend (production: the built React app is served by the same origin) ---
  const clientDist = path.resolve(process.cwd(), "../client/dist");
  if (isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
