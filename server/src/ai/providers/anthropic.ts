import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiOutputError, type AiFailureKind, type GenerateRequest, type GenerateResult, type LlmProvider, type TokenUsage } from "./types";

/**
 * Claude via the official Anthropic SDK. Uses structured outputs
 * (`messages.parse` + zod schema) and explicit prompt-cache breakpoints on
 * the system blocks marked `cache`.
 */
export function createAnthropicProvider(options: { apiKey: string; model: string; timeoutMs: number }): LlmProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    // The SDK retries 408/409/429/5xx and connection errors with backoff;
    // 2 retries keeps worst-case latency bounded for the admin UI.
    maxRetries: 2,
  });

  return {
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const response = await client.messages.parse({
        model: options.model,
        max_tokens: request.maxTokens,
        system: request.system.map((block) => ({
          type: "text" as const,
          text: block.text,
          ...(block.cache && { cache_control: { type: "ephemeral" as const } }),
        })),
        messages: [{ role: "user", content: request.userContent }],
        output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
      });

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      if (response.stop_reason === "refusal") {
        throw new AiOutputError("refused", "The model declined to respond to this ticket", usage);
      }
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        throw new AiOutputError("invalid_output", `Model output was incomplete (stop_reason=${response.stop_reason})`, usage);
      }
      return { output: response.parsed_output, model: response.model, usage };
    },

    classifyError(error: unknown): AiFailureKind {
      // Most specific first - all of these extend Anthropic.APIError.
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth";
      if (error instanceof Anthropic.RateLimitError) return "rate_limited";
      if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return "bad_request";
      if (error instanceof Anthropic.APIConnectionError) return "unavailable"; // includes timeouts
      if (error instanceof Anthropic.InternalServerError) return "unavailable";
      if (error instanceof Anthropic.APIError) return (error.status ?? 500) >= 500 ? "unavailable" : "bad_request";
      // Not an HTTP/network failure - e.g. the SDK could not parse the model's
      // output against our schema. Per-request, so it must not trip the breaker.
      return "invalid_output";
    },
  };
}
