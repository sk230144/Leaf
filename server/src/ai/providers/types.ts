import type { z } from "zod";

/**
 * Provider-neutral contract for one structured LLM call. Prompts, schema
 * validation, the circuit breaker and usage logging live in ../llm.ts and are
 * shared; a provider only translates the request to its SDK and classifies
 * that SDK's errors.
 */

export type AiFailureKind =
  | "disabled" // no API key configured
  | "circuit_open" // recent failures; skipping calls for a cool-down period
  | "rate_limited"
  | "unavailable" // 5xx / overloaded / network / timeout
  | "auth" // bad API key
  | "bad_request"
  | "refused"
  | "invalid_output";

export class AiUnavailableError extends Error {
  constructor(
    public readonly kind: AiFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** A system-prompt segment. `cache` marks the end of a stable, reusable prefix. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export type Effort = "low" | "medium" | "high";

export interface GenerateRequest {
  system: SystemBlock[];
  userContent: string;
  schema: z.ZodType;
  maxTokens: number;
  effort: Effort;
}

export interface TokenUsage {
  /** Uncached prompt tokens */
  inputTokens: number;
  /** Generated tokens, including thinking tokens (billed as output) */
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface GenerateResult {
  /** Parsed JSON output - validated against the schema by the caller */
  output: unknown;
  model: string;
  usage: TokenUsage;
}

export interface LlmProvider {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /** Map an SDK/network error to a failure kind (never throws). */
  classifyError(error: unknown): AiFailureKind;
}

/** Thrown by providers when a response arrived but is unusable; carries its usage for logging. */
export class AiOutputError extends AiUnavailableError {
  constructor(
    kind: "refused" | "invalid_output",
    message: string,
    public readonly usage?: TokenUsage,
  ) {
    super(kind, message);
  }
}
