import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/**
 * Single optional attachment per ticket (e.g. photos of a misprint).
 * Files get a random storage key - the original name is only metadata and is
 * never used as a path, which rules out path traversal.
 */
export const ticketAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_ROOT,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED_TYPES[file.mimetype] ?? ""}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new AppError(400, "INVALID_ATTACHMENT", "Attachments must be PNG, JPG, WEBP or PDF"));
  },
}).single("attachment");
