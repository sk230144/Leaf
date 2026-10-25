import { Router } from "express";
import { aiStatus } from "../../ai/llm";
import { prisma } from "../../lib/prisma";
import { authenticate, requireRole } from "../../middleware/auth";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole("ADMIN"));

/**
 * Indicative USD prices per million tokens for the default model
 * (claude-haiku-5-5). Used only for the dashboard's cost estimate.
 */
const PRICE_PER_MTOK = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

/** GET /api/admin/users - admins available for ticket assignment */
adminRouter.get("/users", async (_req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  res.json({ data: admins });
});

/** GET /api/admin/stats - queue health, AI usage/cost and AI quality signals */
adminRouter.get("/stats", async (_req, res) => {
  const active = { status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [byStatus, byPriority, unassigned, awaitingFirstResponse, oldestActive, usage, aiClassified, categoryOverrides, adminReplies, draftReplies] =
    await Promise.all([
      prisma.ticket.groupBy({ by: ["status"], _count: true }),
      prisma.ticket.groupBy({ by: ["priority"], where: active, _count: true }),
      prisma.ticket.count({ where: { ...active, assigneeId: null } }),
      prisma.ticket.count({ where: { ...active, firstResponseAt: null } }),
      prisma.ticket.findFirst({ where: active, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.aiUsageLog.groupBy({
        by: ["operation", "success"],
        where: { createdAt: { gte: since } },
        _count: true,
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
        _avg: { latencyMs: true },
      }),
      prisma.ticketEvent.count({ where: { type: "CLASSIFIED", toValue: { endsWith: "(AI)" } } }),
      prisma.ticketEvent.count({ where: { type: "CATEGORY_CHANGED", actorId: { not: null } } }),
      prisma.ticketMessage.count({ where: { senderRole: "ADMIN" } }),
      prisma.ticketMessage.count({ where: { senderRole: "ADMIN", fromAiDraft: true } }),
    ]);

  const totals = usage.reduce(
    (acc, row) => {
      acc.calls += row._count;
      if (!row.success) acc.failures += row._count;
      acc.inputTokens += row._sum.inputTokens ?? 0;
      acc.outputTokens += row._sum.outputTokens ?? 0;
      acc.cacheReadTokens += row._sum.cacheReadTokens ?? 0;
      acc.cacheWriteTokens += row._sum.cacheWriteTokens ?? 0;
      return acc;
    },
    { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  const estimatedCostUsd =
    (totals.inputTokens * PRICE_PER_MTOK.input +
      totals.outputTokens * PRICE_PER_MTOK.output +
      totals.cacheReadTokens * PRICE_PER_MTOK.cacheRead +
      totals.cacheWriteTokens * PRICE_PER_MTOK.cacheWrite) /
    1_000_000;
  const promptTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;

  res.json({
    data: {
      tickets: {
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
        activeByPriority: Object.fromEntries(byPriority.map((row) => [row.priority ?? "UNCLASSIFIED", row._count])),
        unassignedActive: unassigned,
        awaitingFirstResponse,
        oldestActiveCreatedAt: oldestActive?.createdAt ?? null,
      },
      ai: {
        ...aiStatus(),
        last30Days: {
          ...totals,
          cacheHitRate: promptTokens ? totals.cacheReadTokens / promptTokens : 0,
          estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
          byOperation: usage.map((row) => ({
            operation: row.operation,
            success: row.success,
            calls: row._count,
            avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
          })),
        },
        quality: {
          aiClassifications: aiClassified,
          categoryOverrides,
          // Share of admin replies that started from the AI draft
          draftAdoptionRate: adminReplies ? draftReplies / adminReplies : null,
        },
      },
    },
  });
});
