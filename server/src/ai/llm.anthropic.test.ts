/**
 * Claude provider: exercises the real Anthropic SDK against a local fake Messages API, so the
 * request we build (cache breakpoints, structured-output schema, effort) and
 * the failure handling (rate limits -> circuit breaker) are tested without a
 * real API key or network access.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Reply = { status: number; body: unknown };
const requests: Record<string, any>[] = [];
let nextReplies: Reply[] = [];
let server: http.Server;
const suiteStart = new Date();

let llm: typeof import("./llm");
let prompts: typeof import("./prompts");
let prisma: typeof import("../lib/prisma")["prisma"];

const okMessage = (json: unknown) => ({
  status: 200,
  body: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify(json) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
});

const rateLimited: Reply = { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}"));
      const reply = nextReplies.shift() ?? rateLimited;
      res.writeHead(reply.status, { "content-type": "application/json", "retry-after-ms": "1" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Import after env is set: the client is configured at module load.
  llm = await import("./llm");
  prompts = await import("./prompts");
  prisma = (await import("../lib/prisma")).prisma;
});

afterAll(async () => {
  server.close();
  // Don't leave fake usage rows in the dashboard's cost stats.
  await new Promise((r) => setTimeout(r, 100));
  await prisma.aiUsageLog.deleteMany({ where: { createdAt: { gte: suiteStart }, model: "claude-haiku-5-5", ticketId: null } });
  await prisma.$disconnect();
});

beforeEach(() => {
  requests.length = 0;
  nextReplies = [];
  llm.__resetBreakerForTests();
});

describe("callStructured", () => {
  it("sends a cached system prompt, JSON schema and effort, and parses the result", async () => {
    nextReplies = [okMessage({ category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.92, summary: "Royalty never paid" })];
    const prompt = prompts.buildClassificationPrompt({ subject: "No royalty", description: "Never paid", triageFacts: "facts" });

    const { data } = await llm.callStructured({
      operation: "CLASSIFY",
      system: prompt.system,
      userContent: prompt.user,
      schema: prompts.ClassificationSchema,
      maxTokens: 1024,
      effort: "low",
    });

    expect(data).toEqual({ category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.92, summary: "Royalty never paid" });
    const sent = requests[0];
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sent.output_config.effort).toBe("low");
    expect(sent.output_config.format.type).toBe("json_schema");
    // The SDK's zod helper conveys enums to the model via the schema and enforces them client-side.
    expect(JSON.stringify(sent.output_config.format.schema.properties.category)).toContain("ISBN_METADATA");
    expect(sent.messages[0].content).toContain("<ticket>");
  });

  it("records token usage including cache reads", async () => {
    nextReplies = [okMessage({ category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.8, summary: "Bio update" })];
    const since = new Date();
    const prompt = prompts.buildClassificationPrompt({ subject: "Bio", description: "Update bio", triageFacts: "" });
    await llm.callStructured({ operation: "CLASSIFY", system: prompt.system, userContent: prompt.user, schema: prompts.ClassificationSchema, maxTokens: 512, effort: "low" });
    await new Promise((r) => setTimeout(r, 200)); // usage is logged fire-and-forget

    const log = await prisma.aiUsageLog.findFirst({
      where: { createdAt: { gte: since }, success: true, model: "claude-haiku-5-5" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toMatchObject({ operation: "CLASSIFY", inputTokens: 120, outputTokens: 40, cacheReadTokens: 900 });
  });

  it("maps rate limits to a typed error and opens the circuit after repeated failures", async () => {
    const prompt = prompts.buildClassificationPrompt({ subject: "x", description: "y", triageFacts: "" });
    const call = () =>
      llm.callStructured({ operation: "CLASSIFY", system: prompt.system, userContent: prompt.user, schema: prompts.ClassificationSchema, maxTokens: 256, effort: "low" });

    for (let i = 0; i < 3; i++) {
      await expect(call()).rejects.toMatchObject({ name: "AiUnavailableError", kind: "rate_limited" });
    }
    // SDK retried each call (1 + 2 retries) before giving up
    expect(requests.length).toBe(9);
    expect(llm.aiStatus().available).toBe(false);

    // Breaker is open: fail fast without touching the API
    await expect(call()).rejects.toMatchObject({ kind: "circuit_open" });
    expect(requests.length).toBe(9);
  });

  it("rejects output that does not match the schema", async () => {
    nextReplies = [okMessage({ category: "SOMETHING_ELSE", priority: "HIGH", confidence: 1, summary: "x" })];
    const prompt = prompts.buildClassificationPrompt({ subject: "x", description: "y", triageFacts: "" });
    await expect(
      llm.callStructured({ operation: "CLASSIFY", system: prompt.system, userContent: prompt.user, schema: prompts.ClassificationSchema, maxTokens: 256, effort: "low" }),
    ).rejects.toMatchObject({ name: "AiUnavailableError", kind: "invalid_output" });
    // A bad response is request-specific and must not pause the AI for everyone.
    expect(llm.aiStatus().available).toBe(true);
  });

  it("sends only the category's knowledge base sections for drafts, with two cache breakpoints", async () => {
    nextReplies = [
      okMessage({ reply: "Dear Farhan, ...", suggested_status: "IN_PROGRESS", needs_escalation: true, escalation_note: "Print team: verify photos", missing_info: [] }),
    ];
    const { data } = await llm.callStructured({
      operation: "DRAFT",
      system: prompts.buildDraftSystem("PRINTING_QUALITY"),
      userContent: "thread",
      schema: prompts.DraftSchema,
      maxTokens: 4000,
      effort: "medium",
    });
    expect(data.needs_escalation).toBe(true);
    const system = requests[0].system as { text: string; cache_control?: unknown }[];
    expect(system.filter((block) => block.cache_control)).toHaveLength(2);
    const allText = system.map((block) => block.text).join("\n");
    expect(allText).toContain("free reprint");
    expect(allText).not.toContain("Royalty Policy");
  });
});
