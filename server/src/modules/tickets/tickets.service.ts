import fs from "node:fs/promises";
import type { Prisma, Ticket, TicketEventType, TicketStatus } from "@prisma/client";
import { enqueueClassification } from "../../ai/jobs";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { publish } from "../../realtime/eventBus";
import type { AuthUser } from "../../types/express";
import type {
  CreateMessageBody,
  CreateNoteBody,
  CreateTicketBody,
  ListTicketsQuery,
  UpdateTicketBody,
} from "./tickets.schemas";
import { serializeTicketDetail, serializeTicketSummary, ticketDetailInclude, ticketListInclude } from "./tickets.serializer";

const isAdmin = (user: AuthUser) => user.role === "ADMIN";

/**
 * Loads a ticket the user is allowed to see. Authors get a 404 (not 403) for
 * other authors' tickets so ticket IDs can't be probed.
 */
async function findAccessibleTicket(user: AuthUser, ticketId: string): Promise<Ticket> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || (!isAdmin(user) && ticket.authorId !== user.authorId)) throw notFound("Ticket");
  return ticket;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listTickets(user: AuthUser, query: ListTicketsQuery) {
  const where: Prisma.TicketWhereInput = {};

  if (!isAdmin(user)) where.authorId = user.authorId!;
  else if (query.authorId) where.authorId = query.authorId;

  if (query.status) where.status = { in: query.status };
  if (query.bookId) where.bookId = query.bookId;
  if (isAdmin(user)) {
    if (query.category) where.category = { in: query.category };
    if (query.priority) where.priority = { in: query.priority };
    if (query.assignee === "me") where.assigneeId = user.id;
    else if (query.assignee === "unassigned") where.assigneeId = null;
    else if (query.assignee) where.assigneeId = query.assignee;
  }
  if (query.from || query.to) where.createdAt = { gte: query.from, lte: query.to };
  if (query.q) {
    const number = Number(query.q.replace(/^BL-/i, ""));
    where.OR = [
      { subject: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      ...(isAdmin(user) ? [{ author: { user: { name: { contains: query.q, mode: "insensitive" as const } } } }] : []),
      ...(Number.isInteger(number) && number > 0 ? [{ number }] : []),
    ];
  }

  const orderBy: Prisma.TicketOrderByWithRelationInput[] = {
    // Unclassified tickets surface first so nothing new is hidden at the bottom.
    urgency: [{ priority: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    oldest: [{ createdAt: "asc" }],
    newest: [{ createdAt: "desc" }],
    updated: [{ updatedAt: "desc" }],
  }[query.sort] as Prisma.TicketOrderByWithRelationInput[];

  const [rows, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy,
      include: ticketListInclude,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    data: rows.map((row) => serializeTicketSummary(row, isAdmin(user))),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

export async function getTicket(user: AuthUser, ticketId: string) {
  await findAccessibleTicket(user, ticketId);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: ticketDetailInclude });
  return serializeTicketDetail(ticket, isAdmin(user));
}

export async function getAttachment(user: AuthUser, ticketId: string, attachmentId: string) {
  await findAccessibleTicket(user, ticketId);
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, ticketId } });
  if (!attachment) throw notFound("Attachment");
  return attachment;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function createTicket(user: AuthUser, input: CreateTicketBody, file?: Express.Multer.File) {
  const authorId = user.authorId!;
  try {
    if (input.bookId) {
      const book = await prisma.book.findUnique({ where: { id: input.bookId }, select: { authorId: true } });
      if (!book || book.authorId !== authorId) throw badRequest("Validation failed", [{ field: "bookId", message: "Select one of your books" }]);
    }

    const ticket = await prisma.ticket.create({
      data: {
        authorId,
        bookId: input.bookId,
        subject: input.subject,
        description: input.description,
        events: { create: { type: "CREATED", actorId: user.id } },
        ...(file && {
          attachments: {
            create: { originalName: file.originalname.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.size, storageKey: file.filename },
          },
        }),
      },
    });

    // Classification runs in the background; the author gets an instant response.
    enqueueClassification(ticket.id);
    publish("ticket.created", ticket);
    return getTicket(user, ticket.id);
  } catch (error) {
    // Don't leave orphaned uploads behind when creation fails.
    if (file) await fs.unlink(file.path).catch(() => undefined);
    throw error;
  }
}

export async function updateTicket(admin: AuthUser, ticketId: string, input: UpdateTicketBody) {
  const ticket = await findAccessibleTicket(admin, ticketId);
  const data: Prisma.TicketUncheckedUpdateInput = {};
  const events: { type: TicketEventType; fromValue: string | null; toValue: string | null }[] = [];

  if (input.status && input.status !== ticket.status) {
    Object.assign(data, statusTransition(input.status));
    events.push({ type: "STATUS_CHANGED", fromValue: ticket.status, toValue: input.status });
  }
  if (input.category && input.category !== ticket.category) {
    data.category = input.category;
    data.categorySource = "ADMIN";
    events.push({ type: "CATEGORY_CHANGED", fromValue: ticket.category, toValue: input.category });
  }
  if (input.priority && input.priority !== ticket.priority) {
    data.priority = input.priority;
    data.prioritySource = "ADMIN";
    events.push({ type: "PRIORITY_CHANGED", fromValue: ticket.priority, toValue: input.priority });
  }
  if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
    if (input.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: input.assigneeId }, select: { role: true } });
      if (assignee?.role !== "ADMIN") throw badRequest("Validation failed", [{ field: "assigneeId", message: "Tickets can only be assigned to admins" }]);
    }
    data.assigneeId = input.assigneeId;
    events.push({ type: "ASSIGNED", fromValue: ticket.assigneeId, toValue: input.assigneeId });
  }

  if (events.length > 0) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { ...data, events: { create: events.map((event) => ({ ...event, actorId: admin.id })) } },
    });
    // Status is author-visible; triage changes are not.
    publish(events.some((e) => e.type === "STATUS_CHANGED") ? "ticket.updated" : "ticket.internal", ticket);
  }
  return getTicket(admin, ticketId);
}

function statusTransition(status: TicketStatus): Prisma.TicketUncheckedUpdateInput {
  const closing = status === "RESOLVED" || status === "CLOSED";
  return { status, resolvedAt: closing ? new Date() : null };
}

export async function addMessage(user: AuthUser, ticketId: string, input: CreateMessageBody) {
  const ticket = await findAccessibleTicket(user, ticketId);
  const admin = isAdmin(user);

  if (ticket.status === "CLOSED" && !admin) {
    throw conflict("This ticket is closed. Please raise a new ticket if you need more help.");
  }

  // Default status flow: an admin reply moves an OPEN ticket to IN_PROGRESS;
  // an author follow-up on a RESOLVED ticket reopens it.
  let nextStatus: TicketStatus | undefined;
  if (admin) nextStatus = input.status ?? (ticket.status === "OPEN" ? "IN_PROGRESS" : undefined);
  else if (ticket.status === "RESOLVED") nextStatus = "OPEN";
  if (nextStatus === ticket.status) nextStatus = undefined;

  await prisma.$transaction([
    prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: user.id,
        senderRole: user.role,
        body: input.body,
        fromAiDraft: admin && (input.fromAiDraft ?? false),
      },
    }),
    prisma.ticket.update({
      where: { id: ticketId },
      data: {
        ...(nextStatus && statusTransition(nextStatus)),
        ...(admin && !ticket.firstResponseAt && { firstResponseAt: new Date() }),
        ...(nextStatus && {
          events: { create: { type: "STATUS_CHANGED", fromValue: ticket.status, toValue: nextStatus, actorId: user.id } },
        }),
      },
    }),
  ]);

  publish("ticket.message", ticket);
  return getTicket(user, ticketId);
}

export async function addNote(admin: AuthUser, ticketId: string, input: CreateNoteBody) {
  const ticket = await findAccessibleTicket(admin, ticketId);
  await prisma.internalNote.create({ data: { ticketId, adminId: admin.id, body: input.body } });
  publish("ticket.internal", ticket);
  return getTicket(admin, ticketId);
}
