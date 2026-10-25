import type { AiDraft, Book, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { notFound } from "../lib/errors";
import { clip, describeBook, formatDate, upcomingRoyaltyPayout } from "./context";
import { templateDraft } from "./fallback";
import { CATEGORY_LABELS } from "./knowledgeBase";
import { AiUnavailableError, aiStatus, callStructured, type AiFailureKind } from "./llm";
import { buildDraftSystem, buildDraftUserPrompt, DraftSchema } from "./prompts";

/**
 * Produces the suggested reply an admin sees when opening a ticket.
 *
 * Cost controls:
 *  - Drafts are persisted and reused: re-opening a ticket costs nothing.
 *    A draft is regenerated only when the thread has changed (new message),
 *    when the admin explicitly asks, or to upgrade a template draft once the
 *    AI is reachable again.
 *  - Concurrent requests for the same ticket share one in-flight call.
 *  - Only the KB sections for the ticket's category are sent (cached prefix).
 *  - Only the referenced book's facts and the most recent part of the thread
 *    are sent, each clipped to a maximum length.
 */

const MAX_THREAD_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 1500;
const MAX_BOOKS_FOR_ACCOUNT_TICKETS = 5;

export interface DraftResult {
  draft: AiDraft;
  /** Set when this request fell back to a template */
  fallbackReason: AiFailureKind | null;
}

const ticketForDraft = {
  book: true,
  author: { include: { user: { select: { name: true } }, books: { orderBy: { id: "asc" } } } },
  messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { name: true } } } },
  draft: true,
} satisfies Prisma.TicketInclude;

type TicketForDraft = Prisma.TicketGetPayload<{ include: typeof ticketForDraft }>;

const inFlight = new Map<string, Promise<DraftResult>>();

export function getOrCreateDraft(ticketId: string, options: { regenerate?: boolean } = {}): Promise<DraftResult> {
  const pending = inFlight.get(ticketId);
  if (pending) return pending;

  const promise = resolveDraft(ticketId, options.regenerate ?? false).finally(() => inFlight.delete(ticketId));
  inFlight.set(ticketId, promise);
  return promise;
}

async function resolveDraft(ticketId: string, regenerate: boolean): Promise<DraftResult> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: ticketForDraft });
  if (!ticket) throw notFound("Ticket");

  const messageCount = ticket.messages.length;
  const existing = ticket.draft;
  const canUpgradeTemplate = existing?.source === "TEMPLATE" && aiStatus().available;
  if (existing && existing.messageCount === messageCount && !regenerate && !canUpgradeTemplate) {
    return { draft: existing, fallbackReason: null };
  }

  const category = ticket.category ?? "GENERAL_INQUIRY";
  try {
    const { data, model } = await callStructured({
      operation: "DRAFT",
      ticketId,
      system: buildDraftSystem(category),
      userContent: buildUserPrompt(ticket),
      schema: DraftSchema,
      maxTokens: 8000, // includes thinking tokens
      effort: "medium",
    });
    const draft = await saveDraft(ticketId, {
      source: "AI",
      content: data.reply.trim(),
      suggestedStatus: data.suggested_status,
      needsEscalation: data.needs_escalation,
      escalationNote: data.escalation_note.trim() || null,
      missingInfo: data.missing_info,
      model,
      messageCount,
    });
    return { draft, fallbackReason: null };
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    const draft = await saveDraft(ticketId, {
      source: "TEMPLATE",
      content: templateDraft(category, ticket.author.user.name, ticket.book),
      suggestedStatus: null,
      needsEscalation: false,
      escalationNote: null,
      missingInfo: [],
      model: null,
      messageCount,
    });
    return { draft, fallbackReason: error.kind };
  }
}

function saveDraft(ticketId: string, data: Omit<Prisma.AiDraftUncheckedCreateInput, "ticketId">) {
  return prisma.aiDraft.upsert({
    where: { ticketId },
    create: { ticketId, ...data },
    update: data,
  });
}

function buildUserPrompt(ticket: TicketForDraft): string {
  const today = new Date();
  const category = ticket.category ?? "GENERAL_INQUIRY";

  // Only the book the ticket is about; for account-level tickets, the author's
  // books (authors typically have 1-3).
  const books: Book[] = ticket.book ? [ticket.book] : ticket.author.books.slice(0, MAX_BOOKS_FOR_ACCOUNT_TICKETS);
  const accountFacts = books.length
    ? books.map((book) => describeBook(book, today)).join("\n\n")
    : "The author has no books on record yet.";

  // Payout schedule only matters for money questions.
  let payoutFacts = "";
  if (category === "ROYALTY_PAYMENTS" || category === "GENERAL_INQUIRY") {
    const payout = upcomingRoyaltyPayout(today);
    payoutFacts = `Royalty schedule: the next payout covers ${payout.quarterLabel} (quarter ends ${formatDate(payout.quarterEnd)}) and will be paid by ${formatDate(payout.payoutDeadline)}, for balances of ₹1,000 or more. Bank details on file: not visible to you - use a placeholder if relevant.`;
  }

  return buildDraftUserPrompt({
    today: formatDate(today),
    authorName: ticket.author.user.name,
    authorCity: ticket.author.city,
    categoryLabel: CATEGORY_LABELS[category],
    priority: ticket.priority ?? "MEDIUM",
    accountFacts,
    payoutFacts,
    ticketNumber: ticket.number,
    subject: ticket.subject,
    thread: formatThread(ticket),
  });
}

/** Original query + the most recent replies, oldest first, each clipped. */
function formatThread(ticket: TicketForDraft): string {
  const entries = [
    `[Author, ${formatDate(ticket.createdAt)}]\n${clip(ticket.description, MAX_MESSAGE_CHARS * 2)}`,
  ];
  const recent = ticket.messages.slice(-MAX_THREAD_MESSAGES);
  const omitted = ticket.messages.length - recent.length;
  if (omitted > 0) entries.push(`[... ${omitted} earlier message(s) omitted ...]`);
  for (const message of recent) {
    const who = message.senderRole === "ADMIN" ? `BookLeaf Support (${message.sender.name})` : "Author";
    entries.push(`[${who}, ${formatDate(message.createdAt)}]\n${clip(message.body, MAX_MESSAGE_CHARS)}`);
  }
  return entries.join("\n\n");
}
