import type { Prisma } from "@prisma/client";
import { CATEGORY_LABELS } from "../../ai/knowledgeBase";
import { STAGE_LABELS } from "../../domain/bookStages";

/**
 * Role-aware ticket serialization. Authors never receive triage data
 * (priority, AI confidence, internal notes, assignee, audit events) - only
 * their query, its status, and the public conversation.
 */

export const ticketListInclude = {
  book: { select: { id: true, title: true } },
  author: { select: { id: true, user: { select: { name: true } } } },
  assignee: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "desc" }, take: 1, select: { senderRole: true, createdAt: true } },
  _count: { select: { messages: true, attachments: true } },
} satisfies Prisma.TicketInclude;

export const ticketDetailInclude = {
  book: true,
  author: { include: { user: { select: { name: true, email: true } } } },
  assignee: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { name: true } } } },
  notes: { orderBy: { createdAt: "asc" }, include: { admin: { select: { name: true } } } },
  events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } },
  attachments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.TicketInclude;

type TicketListRow = Prisma.TicketGetPayload<{ include: typeof ticketListInclude }>;
type TicketDetailRow = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;

const reference = (number: number) => `BL-${number}`;

function publicSummary(ticket: TicketListRow | TicketDetailRow) {
  const lastMessage = "_count" in ticket ? ticket.messages[0] : ticket.messages.at(-1);
  return {
    id: ticket.id,
    number: ticket.number,
    reference: reference(ticket.number),
    subject: ticket.subject,
    status: ticket.status,
    book: ticket.book ? { id: ticket.book.id, title: ticket.book.title } : null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastActivityAt: lastMessage?.createdAt ?? ticket.createdAt,
    /** True when the latest word is the author's - i.e. BookLeaf owes a reply */
    awaitingSupport: !lastMessage || lastMessage.senderRole === "AUTHOR",
  };
}

function triage(ticket: TicketListRow | TicketDetailRow) {
  return {
    category: ticket.category,
    categoryLabel: ticket.category ? CATEGORY_LABELS[ticket.category] : null,
    categorySource: ticket.categorySource,
    priority: ticket.priority,
    prioritySource: ticket.prioritySource,
    aiStatus: ticket.aiStatus,
    aiConfidence: ticket.aiConfidence,
    aiSummary: ticket.aiSummary,
    aiError: ticket.aiError,
    assignee: ticket.assignee,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
  };
}

export function serializeTicketSummary(ticket: TicketListRow, forAdmin: boolean) {
  const base = { ...publicSummary(ticket), messageCount: ticket._count.messages, hasAttachment: ticket._count.attachments > 0 };
  if (!forAdmin) return base;
  return { ...base, author: { id: ticket.author.id, name: ticket.author.user.name }, ...triage(ticket) };
}

export function serializeTicketDetail(ticket: TicketDetailRow, forAdmin: boolean) {
  const base = {
    ...publicSummary(ticket),
    description: ticket.description,
    attachments: ticket.attachments.map((file) => ({
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      url: `/api/tickets/${ticket.id}/attachments/${file.id}`,
    })),
    messages: ticket.messages.map((message) => ({
      id: message.id,
      body: message.body,
      senderRole: message.senderRole,
      senderName: message.sender.name,
      createdAt: message.createdAt,
      ...(forAdmin && { fromAiDraft: message.fromAiDraft }),
    })),
  };
  if (!forAdmin) return base;

  const book = ticket.book;
  return {
    ...base,
    ...triage(ticket),
    author: {
      id: ticket.author.id,
      name: ticket.author.user.name,
      email: ticket.author.user.email,
      phone: ticket.author.phone,
      city: ticket.author.city,
      joinedDate: ticket.author.joinedDate,
    },
    bookDetails: book && {
      id: book.id,
      title: book.title,
      isbn: book.isbn,
      stage: book.stage,
      stageLabel: STAGE_LABELS[book.stage],
      publicationDate: book.publicationDate,
      mrp: book.mrp,
      copiesSold: book.copiesSold,
      royaltyEarned: book.royaltyEarned,
      royaltyPaid: book.royaltyPaid,
      royaltyPending: book.royaltyPending,
      lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate,
      printPartner: book.printPartner,
      availableOn: book.availableOn,
    },
    notes: ticket.notes.map((note) => ({ id: note.id, body: note.body, adminName: note.admin.name, createdAt: note.createdAt })),
    events: ticket.events.map((event) => ({
      id: event.id,
      type: event.type,
      fromValue: event.fromValue,
      toValue: event.toValue,
      actorName: event.actor?.name ?? null,
      createdAt: event.createdAt,
    })),
  };
}
