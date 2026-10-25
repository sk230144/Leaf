import type { ClassificationSource, TicketCategory, TicketPriority } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { publish } from "../realtime/eventBus";
import { bookTriageLine, clip } from "./context";
import { classifyByRules } from "./fallback";
import { AiUnavailableError, callStructured } from "./llm";
import { buildClassificationPrompt, ClassificationSchema } from "./prompts";

/**
 * Classifies a ticket's category and priority in a single LLM call, falling
 * back to keyword rules if the AI is unavailable. Never throws for AI
 * failures - a ticket always ends up classified one way or the other.
 *
 * Cost notes: one call (not two) for category + priority; the system prompt
 * is static and cached; the user turn carries only the subject, a clipped
 * description and a one-line account summary - not the knowledge base, not
 * the author's other tickets.
 */
export async function classifyTicket(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { book: true } });
  if (!ticket) return;

  const today = new Date();
  let source: ClassificationSource;
  let aiError: string | null = null;
  let result: { category: TicketCategory; priority: TicketPriority; confidence: number; summary: string };

  try {
    const prompt = buildClassificationPrompt({
      subject: clip(ticket.subject, 300),
      description: clip(ticket.description, 4000),
      triageFacts: bookTriageLine(ticket.book, today),
    });
    const { data } = await callStructured({
      operation: "CLASSIFY",
      ticketId,
      system: prompt.system,
      userContent: prompt.user,
      schema: ClassificationSchema,
      maxTokens: 1024,
      effort: "low", // simple labelling task; low effort keeps it fast and cheap
    });
    result = { ...data, confidence: Math.min(1, Math.max(0, data.confidence)) };
    source = "AI";
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    result = classifyByRules(ticket.subject, ticket.description, ticket.book, today);
    source = "RULES";
    aiError = error.kind;
  }

  // Re-read sources: an admin may have overridden while the AI call was in
  // flight, and an admin decision must never be overwritten by automation.
  const latest = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { categorySource: true, prioritySource: true },
  });

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticketId },
      data: {
        aiStatus: source === "AI" ? "COMPLETED" : "FAILED",
        aiConfidence: result.confidence,
        aiSummary: result.summary,
        aiError,
        ...(latest.categorySource !== "ADMIN" && { category: result.category, categorySource: source }),
        ...(latest.prioritySource !== "ADMIN" && { priority: result.priority, prioritySource: source }),
      },
    }),
    prisma.ticketEvent.create({
      data: { ticketId, type: "CLASSIFIED", toValue: `${result.category} / ${result.priority} (${source})` },
    }),
  ]);

  logger.info("Ticket classified", { ticketId, source, category: result.category, priority: result.priority });
  publish("ticket.updated", ticket);
}
