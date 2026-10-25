import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiOperation } from "@prisma/client";
import type { z } from "zod";
import { aiEnabled, env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

/**
 * Thin wrapper around the Anthropic SDK that every AI feature goes through.
 * It owns the cross-cutting production concerns so feature code doesn't:
 *  - the API key stays server-side (read from env, never serialized)
 *  - a circuit breaker stops hammering the API during an outage / rate limit
 *  - typed SDK errors are mapped to a small set of failure kinds
 *  - every call's token usage (incl. cache hits) and latency is logged
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

const client = aiEnabled
  ? new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: env.AI_TIMEOUT_MS,
      // The SDK already retries 408/409/429/5xx and connection errors with
      // backoff; 2 retries keeps worst-case latency bounded for the admin UI.
      maxRetries: 2,
    })
  : null;

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

const FAILURE_THRESHOLD = 3;
const COOL_DOWN_MS = 60_000;
const AUTH_COOL_DOWN_MS = 10 * 60_000;

const breaker = { consecutiveFailures: 0, openUntil: 0 };

function recordSuccess() {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

function recordFailure(kind: AiFailureKind) {
  if (kind === "auth") {
    // A bad key won't fix itself in a minute; back off for longer.
    breaker.openUntil = Date.now() + AUTH_COOL_DOWN_MS;
    return;
  }
  if (kind !== "rate_limited" && kind !== "unavailable") return; // request-specific, not systemic
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + COOL_DOWN_MS;
    logger.warn("AI circuit breaker opened", { coolDownMs: COOL_DOWN_MS });
  }
}

export function aiStatus(): { enabled: boolean; available: boolean; model: string; retryAt: string | null } {
  const open = breaker.openUntil > Date.now();
  return {
    enabled: aiEnabled,
    available: aiEnabled && !open,
    model: env.AI_MODEL,
    retryAt: open ? new Date(breaker.openUntil).toISOString() : null,
  };
}

function toFailureKind(error: unknown): AiFailureKind {
  // Most specific first - all of these extend Anthropic.APIError.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return "bad_request";
  if (error instanceof Anthropic.APIConnectionError) return "unavailable"; // includes timeouts
  if (error instanceof Anthropic.InternalServerError) return "unavailable";
  if (error instanceof Anthropic.APIError) return (error.status ?? 500) >= 500 ? "unavailable" : "bad_request";
  // Not an HTTP/network failure - e.g. the SDK could not parse the model's
  // output against our schema. A per-request problem, so it must not trip
  // the circuit breaker.
  return "invalid_output";
}

// ---------------------------------------------------------------------------
// Structured call
// ---------------------------------------------------------------------------

export interface StructuredCallOptions<T extends z.ZodType> {
  operation: AiOperation;
  ticketId?: string;
  /** System prompt blocks; put stable content first and mark cache breakpoints. */
  system: Anthropic.TextBlockParam[];
  userContent: string;
  schema: T;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

export interface StructuredCallResult<T> {
  data: T;
  model: string;
}

/**
 * Calls Claude with a JSON-schema constrained response and returns the
 * validated object. Throws AiUnavailableError for every failure mode so
 * callers have exactly one thing to catch before falling back.
 */
export async function callStructured<T extends z.ZodType>(
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<z.infer<T>>> {
  if (!client) throw new AiUnavailableError("disabled", "AI is not configured (ANTHROPIC_API_KEY is empty)");
  if (breaker.openUntil > Date.now()) {
    throw new AiUnavailableError("circuit_open", "AI temporarily paused after repeated failures");
  }

  const started = Date.now();
  let usage: Anthropic.Usage | undefined;
  try {
    const response = await client.messages.parse({
      model: env.AI_MODEL,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: [{ role: "user", content: options.userContent }],
      output_config: { effort: options.effort, format: zodOutputFormat(options.schema) },
    });
    usage = response.usage;

    if (response.stop_reason === "refusal") {
      throw new AiUnavailableError("refused", "The model declined to respond to this ticket");
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AiUnavailableError("invalid_output", `Model output was incomplete (stop_reason=${response.stop_reason})`);
    }

    recordSuccess();
    void logUsage(options, started, usage, true);
    return { data: response.parsed_output as z.infer<T>, model: response.model };
  } catch (error) {
    const kind = error instanceof AiUnavailableError ? error.kind : toFailureKind(error);
    recordFailure(kind);
    void logUsage(options, started, usage, false, kind);
    logger.warn("AI call failed", {
      operation: options.operation,
      ticketId: options.ticketId,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof AiUnavailableError) throw error;
    throw new AiUnavailableError(kind, error instanceof Error ? error.message : "AI request failed");
  }
}

async function logUsage(
  options: StructuredCallOptions<z.ZodType>,
  started: number,
  usage: Anthropic.Usage | undefined,
  success: boolean,
  errorType?: AiFailureKind,
) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        operation: options.operation,
        ticketId: options.ticketId,
        model: env.AI_MODEL,
        success,
        errorType,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
        latencyMs: Date.now() - started,
      },
    });
  } catch (error) {
    // Usage logging must never break the user-facing flow.
    logger.warn("Failed to record AI usage", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Test hook: reset breaker state between tests. */
export function __resetBreakerForTests() {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}
