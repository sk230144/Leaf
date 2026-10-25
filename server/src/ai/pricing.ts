/**
 * Indicative list prices in USD per million tokens, used only for the admin
 * dashboard's cost estimate (free-tier usage is actually free). Gemini 3.x
 * Flash prices are Google's introductory rates through 31 Dec 2026.
 * Unknown models contribute tokens but no cost.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Responses may report a versioned model name (e.g. "gemini-3.8-flash-001"); match by prefix. */
function priceFor(model: string): Price | undefined {
  return PRICES[model] ?? Object.entries(PRICES).find(([name]) => model.startsWith(name))?.[1];
}

export function estimateCostUsd(
  model: string,
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): number {
  const price = priceFor(model);
  if (!price) return 0;
  return (
    (tokens.inputTokens * price.input +
      tokens.outputTokens * price.output +
      tokens.cacheReadTokens * price.cacheRead +
      tokens.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}
