import type { AiOperation } from "@prisma/client";
import type { z } from "zod";
import { aiApiKey, aiEnabled, aiModel, aiProvider, env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import {
  AiOutputError,
  AiUnavailableError,
  type AiFailureKind,
  type Effort,
  type LlmProvider,
  type SystemBlock,
  type TokenUsage,
} from "./providers/types";

export { AiUnavailableError, type AiFailureKind, type SystemBlock } from "./providers/types";

/**
 * The single entry point every AI feature goes through. It owns the
 * cross-cutting production concerns so feature code doesn't:
 *  - provider selection (Gemini or Claude, via AI_PROVIDER) - the key stays
 *    server-side and is never serialized
 *  - a circuit breaker stops hammering the API during an outage / rate limit
 *  - provider errors are mapped to a small set of failure kinds
 *  - output is validated against the zod schema regardless of provider
 *  - every call's token usage (incl. cache hits) and latency is logged
 */

function createProvider(): LlmProvider | null {
  if (!aiEnabled) return null;
  const common = { apiKey: aiApiKey, model: aiModel, timeoutMs: env.AI_TIMEOUT_MS };
  if (aiProvider === "anthropic") return createAnthropicProvider(common);
  return createGeminiProvider({
    ...common,
    baseUrl: process.env.GEMINI_BASE_URL || undefined,
    retryInitialDelaySec: process.env.AI_RETRY_DELAY_SEC ? Number(process.env.AI_RETRY_DELAY_SEC) : undefined,
  });
}

const provider = createProvider();

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

export function aiStatus(): { enabled: boolean; available: boolean; provider: string; model: string; retryAt: string | null } {
  const open = breaker.openUntil > Date.now();
  return {
    enabled: aiEnabled,
    available: aiEnabled && !open,
    provider: aiProvider,
    model: aiModel,
    retryAt: open ? new Date(breaker.openUntil).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Structured call
// ---------------------------------------------------------------------------

export interface StructuredCallOptions<T extends z.ZodType> {
  operation: AiOperation;
  ticketId?: string;
  /** System prompt segments; stable content first, `cache` marks reusable prefixes. */
  system: SystemBlock[];
  userContent: string;
  schema: T;
  maxTokens: number;
  effort: Effort;
}

export interface StructuredCallResult<T> {
  data: T;
  model: string;
}

/**
 * Calls the configured model with a JSON-schema constrained response and
 * returns the validated object. Throws AiUnavailableError for every failure
 * mode so callers have exactly one thing to catch before falling back.
 */
export async function callStructured<T extends z.ZodType>(
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<z.infer<T>>> {
  if (!provider) {
    throw new AiUnavailableError("disabled", `AI is not configured (no API key for provider "${aiProvider}")`);
  }
  if (breaker.openUntil > Date.now()) {
    throw new AiUnavailableError("circuit_open", "AI temporarily paused after repeated failures");
  }

  const started = Date.now();
  let usage: TokenUsage | undefined;
  let model = aiModel;
  try {
    const result = await provider.generate(options);
    usage = result.usage;
    model = result.model;

    const parsed = options.schema.safeParse(result.output);
    if (!parsed.success) {
      throw new AiOutputError("invalid_output", `Model output did not match the schema: ${parsed.error.issues[0]?.message}`, usage);
    }

    recordSuccess();
    void logUsage(options, model, started, usage, true);
    return { data: parsed.data as z.infer<T>, model };
  } catch (error) {
    if (error instanceof AiOutputError) usage = error.usage;
    const kind = error instanceof AiUnavailableError ? error.kind : provider.classifyError(error);
    recordFailure(kind);
    void logUsage(options, model, started, usage, false, kind);
    logger.warn("AI call failed", {
      provider: aiProvider,
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
  model: string,
  started: number,
  usage: TokenUsage | undefined,
  success: boolean,
  errorType?: AiFailureKind,
) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        operation: options.operation,
        ticketId: options.ticketId,
        model,
        success,
        errorType,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
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
