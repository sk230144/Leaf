import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { AiOutputError, type AiFailureKind, type Effort, type GenerateRequest, type GenerateResult, type LlmProvider, type TokenUsage } from "./types";

/**
 * Gemini via Google's official `@google/genai` SDK (`models.generateContent`).
 *
 * - Structured output: the zod schema is converted to JSON Schema and sent
 *   as `responseJsonSchema` with `responseMimeType: application/json`; the
 *   result is still validated with zod by the caller.
 * - Thinking depth maps from our effort level to `thinkingLevel`.
 * - Caching: Gemini caches repeated prompt prefixes implicitly (no
 *   breakpoints to set). Our static-first system prompt is what makes that
 *   possible; hits are reported in `cachedContentTokenCount`.
 */

const THINKING_LEVEL: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const REFUSAL_REASONS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

/** JSON Schema for Gemini: drop meta keys it doesn't need (zod still enforces everything). */
function toResponseSchema(schema: z.ZodType): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => key !== "$schema" && key !== "additionalProperties")
          .map(([key, value]) => [key, strip(value)]),
      );
    }
    return node;
  };
  return strip(z.toJSONSchema(schema));
}

export function createGeminiProvider(options: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Test hook: point the SDK at a fake server */
  baseUrl?: string;
  retryInitialDelaySec?: number;
}): LlmProvider {
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      timeout: options.timeoutMs,
      // Retries 408/429/5xx with exponential backoff: 1 try + 2 retries keeps
      // worst-case latency bounded for the admin UI.
      retryOptions: { attempts: 3, initialDelay: options.retryInitialDelaySec ?? 1, maxDelay: 8 },
      ...(options.baseUrl && { baseUrl: options.baseUrl }),
    },
  });

  return {
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const response = await ai.models.generateContent({
        model: options.model,
        contents: request.userContent,
        config: {
          systemInstruction: request.system.map((block) => block.text).join("\n\n"),
          responseMimeType: "application/json",
          responseJsonSchema: toResponseSchema(request.schema),
          maxOutputTokens: request.maxTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL[request.effort] },
        },
      });

      const meta = response.usageMetadata;
      const cached = meta?.cachedContentTokenCount ?? 0;
      const usage: TokenUsage = {
        inputTokens: Math.max(0, (meta?.promptTokenCount ?? 0) - cached),
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      };

      const finishReason = response.candidates?.[0]?.finishReason;
      if (response.promptFeedback?.blockReason || REFUSAL_REASONS.has(finishReason)) {
        throw new AiOutputError("refused", `The model declined to respond (${response.promptFeedback?.blockReason ?? finishReason})`, usage);
      }
      const text = response.text;
      if (finishReason === FinishReason.MAX_TOKENS || !text) {
        throw new AiOutputError("invalid_output", `Model output was incomplete (finishReason=${finishReason})`, usage);
      }
      try {
        return { output: JSON.parse(text), model: response.modelVersion ?? options.model, usage };
      } catch {
        throw new AiOutputError("invalid_output", "Model returned invalid JSON", usage);
      }
    },

    classifyError(error: unknown): AiFailureKind {
      if (error instanceof ApiError) {
        if (error.status === 429) return "rate_limited";
        if (error.status === 401 || error.status === 403) return "auth";
        // An invalid key comes back as 400 API_KEY_INVALID rather than 401.
        if (error.status === 400 && /api[ _-]?key/i.test(error.message)) return "auth";
        if (error.status === 408 || error.status >= 500) return "unavailable";
        return "bad_request";
      }
      // Network failures, timeouts and aborts surface as plain errors.
      return "unavailable";
    },
  };
}
