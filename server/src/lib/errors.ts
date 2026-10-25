/**
 * Application error with an HTTP status and a stable machine-readable code.
 * Route handlers throw these; the error middleware turns them into the
 * standard `{ error: { code, message, details? } }` response body.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource} not found`);

export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
