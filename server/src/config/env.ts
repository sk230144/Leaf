import { z } from "zod";

/**
 * All configuration comes from environment variables and is validated once at
 * startup, so a misconfigured deploy fails fast instead of at first request.
 * Secrets (JWT_SECRET, ANTHROPIC_API_KEY, GEMINI_API_KEY) are only ever read here, on the
 * server - nothing in this module is sent to the browser.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
  /** "gemini" or "anthropic". If unset, whichever provider has a key is used (Gemini preferred). */
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).optional().or(z.literal("").transform(() => undefined)),
  GEMINI_API_KEY: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  /** Model override; empty = the provider's default (see DEFAULT_MODELS). */
  AI_MODEL: z.string().optional().default(""),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Serverless filesystems are read-only except /tmp (files there are ephemeral).
  UPLOAD_DIR: z.string().default(process.env.VERCEL ? "/tmp/uploads" : "uploads"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    console.error(`Invalid environment configuration:\n${issues.join("\n")}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";

export type AiProvider = "gemini" | "anthropic";

const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-haiku-5-5",
};

export const aiProvider: AiProvider = env.AI_PROVIDER ?? (env.GEMINI_API_KEY || !env.ANTHROPIC_API_KEY ? "gemini" : "anthropic");
export const aiApiKey = aiProvider === "gemini" ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
export const aiModel = env.AI_MODEL || DEFAULT_MODELS[aiProvider];
export const aiEnabled = aiApiKey.length > 0;

/**
 * Running as Vercel serverless functions: no long-lived process, so the
 * in-memory SSE fan-out can't reach other instances and clients poll instead.
 */
export const isServerless = Boolean(process.env.VERCEL);
