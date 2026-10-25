/**
 * Gemini provider: exercises the real @google/genai SDK against a local fake
 * Gemini API, so the request we build (system instruction, JSON schema,
 * thinking level) and failure handling (rate limits, bad key, safety blocks)
 * are tested without a real API key or network access.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Reply = { status: number; body: unknown };
const requests: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, any> }[] = [];
let nextReplies: Reply[] = [];
let server: http.Server;
const suiteStart = new Date();

let llm: typeof import("./llm");
let prompts: typeof import("./prompts");
let prisma: typeof import("../lib/prisma")["prisma"];

const okResponse = (json: unknown, finishReason = "STOP"): Reply => ({
  status: 200,
  body: {
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(json) }] }, finishReason }],
    usageMetadata: { promptTokenCount: 900, cachedContentTokenCount: 200, candidatesTokenCount: 50, thoughtsTokenCount: 30, totalTokenCount: 980 },
    modelVersion: "gemini-3.8-flash",
  },
});

const rateLimited: Reply = { status: 429, body: { error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } } };
const badKey: Reply = {
  status: 400,
  body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } },
};

const classification = { category: "ISBN_METADATA", priority: "HIGH", confidence: 0.9, summary: "ISBN mismatch on Amazon" };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") });
      const reply = nextReplies.shift() ?? rateLimited;
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AI_RETRY_DELAY_SEC = "0.01";
  // Import after env is set: the provider is configured at module load.
  llm = await import("./llm");
  prompts = await import("./prompts");
  prisma = (await import("../lib/prisma")).prisma;
});

afterAll(async () => {
  server.close();
  await new Promise((r) => setTimeout(r, 100));
  await prisma.aiUsageLog.deleteMany({ where: { createdAt: { gte: suiteStart }, model: { startsWith: "gemini" }, ticketId: null } });
  await prisma.$disconnect();
});

beforeEach(() => {
  requests.length = 0;
  nextReplies = [];
  llm.__resetBreakerForTests();
});

const classify = () => {
  const prompt = prompts.buildClassificationPrompt({ subject: "ISBN mismatch", description: "Amazon shows a different ISBN", triageFacts: "facts" });
  return llm.callStructured({
    operation: "CLASSIFY",
    system: prompt.system,
    userContent: prompt.user,
    schema: prompts.ClassificationSchema,
    maxTokens: 2048,
    effort: "low",
  });
};

describe("Gemini provider", () => {
  it("reports the provider and model", () => {
    expect(llm.aiStatus()).toMatchObject({ enabled: true, available: true, provider: "gemini", model: "gemini-3.8-flash" });
  });

  it("sends system instruction, JSON schema and thinking level, and parses the result", async () => {
    nextReplies = [okResponse(classification)];
    const { data, model } = await classify();

    expect(data).toEqual(classification);
    expect(model).toBe("gemini-3.8-flash");

    const sent = requests[0];
    expect(sent.url).toContain("models/gemini-3.8-flash:generateContent");
    expect(sent.headers["x-goog-api-key"]).toBe("test-gemini-key");
    const body = JSON.stringify(sent.body);
    expect(body).toContain("triage engine for BookLeaf"); // system instruction
    expect(body).toContain("<ticket>"); // untrusted text in the user turn
    expect(sent.body.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.body.generationConfig.responseJsonSchema.properties.category.enum).toContain("ISBN_METADATA");
    expect(sent.body.generationConfig.thinkingConfig.thinkingLevel).toBe("LOW");
  });

  it("logs usage with thinking tokens counted as output and cache hits split out", async () => {
    nextReplies = [okResponse(classification)];
    const since = new Date();
    await classify();
    await new Promise((r) => setTimeout(r, 200));
    const log = await prisma.aiUsageLog.findFirst({ where: { createdAt: { gte: since }, model: "gemini-3.8-flash" } });
    expect(log).toMatchObject({ success: true, inputTokens: 700, cacheReadTokens: 200, outputTokens: 80 });
  });

  it("maps 429s to rate_limited and opens the circuit after repeated failures", async () => {
    for (let i = 0; i < 3; i++) await expect(classify()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(requests.length).toBe(9); // SDK: 1 attempt + 2 retries per call
    await expect(classify()).rejects.toMatchObject({ kind: "circuit_open" });
    expect(requests.length).toBe(9);
  });

  it("treats an invalid API key (400 API_KEY_INVALID) as an auth failure", async () => {
    nextReplies = [badKey];
    await expect(classify()).rejects.toMatchObject({ kind: "auth" });
    expect(llm.aiStatus().available).toBe(false);
  });

  it("treats a safety block as a refusal without pausing the AI", async () => {
    nextReplies = [okResponse({}, "SAFETY")];
    await expect(classify()).rejects.toMatchObject({ kind: "refused" });
    expect(llm.aiStatus().available).toBe(true);
  });

  it("rejects output that does not match the schema", async () => {
    nextReplies = [okResponse({ ...classification, category: "SOMETHING_ELSE" })];
    await expect(classify()).rejects.toMatchObject({ kind: "invalid_output" });
    expect(llm.aiStatus().available).toBe(true);
  });
});
