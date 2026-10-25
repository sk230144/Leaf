import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../lib/errors";

type Source = "body" | "query" | "params";

/**
 * Validates `req[source]` against a zod schema and stores the parsed result
 * on `res.locals[source]`, so handlers read typed, coerced values.
 * (Express 5 makes `req.query` read-only, hence res.locals.)
 */
export function validate(schema: z.ZodType, source: Source = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message,
      }));
      return next(badRequest("Validation failed", details));
    }
    res.locals[source] = result.data;
    next();
  };
}
