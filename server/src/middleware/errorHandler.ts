import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));
}

/**
 * Converts every error into the standard error envelope. Known error types
 * map to specific 4xx codes; anything unexpected is logged with context and
 * returned as a 500 without leaking internals.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "Attachment exceeds the 5 MB limit" : err.message;
    res.status(400).json({ error: { code: "INVALID_ATTACHMENT", message } });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "CONFLICT", message: "Resource already exists" } });
      return;
    }
  }

  // Malformed JSON body
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }

  logger.error("Unhandled error", {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
  });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side" } });
}
