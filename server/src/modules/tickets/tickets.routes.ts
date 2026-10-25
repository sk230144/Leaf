import path from "node:path";
import { Router, type Request } from "express";
import { classifyTicket } from "../../ai/classifier";
import { getOrCreateDraft } from "../../ai/drafter";
import { aiStatus } from "../../ai/llm";
import { notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { authenticate, currentUser, requireRole } from "../../middleware/auth";
import { ticketAttachmentUpload, UPLOAD_ROOT } from "../../middleware/upload";
import { validate } from "../../middleware/validate";
import {
  CreateMessageBody,
  CreateNoteBody,
  CreateTicketBody,
  ListTicketsQuery,
  UpdateTicketBody,
} from "./tickets.schemas";
import * as tickets from "./tickets.service";

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

const adminOnly = requireRole("ADMIN");

/** Route params are always single strings for these paths (no wildcards). */
const param = (req: Request, name: string) => String(req.params[name]);

/** GET /api/tickets - authors: own tickets; admins: the full queue with filters */
ticketsRouter.get("/", validate(ListTicketsQuery, "query"), async (req, res) => {
  res.json(await tickets.listTickets(currentUser(req), res.locals.query));
});

/** POST /api/tickets - authors raise a ticket (multipart, optional attachment) */
ticketsRouter.post("/", requireRole("AUTHOR"), ticketAttachmentUpload, validate(CreateTicketBody), async (req, res) => {
  const ticket = await tickets.createTicket(currentUser(req), res.locals.body, req.file);
  res.status(201).location(`/api/tickets/${ticket.id}`).json({ data: ticket });
});

/** GET /api/tickets/:id */
ticketsRouter.get("/:id", async (req, res) => {
  res.json({ data: await tickets.getTicket(currentUser(req), param(req, "id")) });
});

/** PATCH /api/tickets/:id - admin: status, category/priority override, assignment */
ticketsRouter.patch("/:id", adminOnly, validate(UpdateTicketBody), async (req, res) => {
  res.json({ data: await tickets.updateTicket(currentUser(req), param(req, "id"), res.locals.body) });
});

/** POST /api/tickets/:id/messages - public reply (author follow-up or admin response) */
ticketsRouter.post("/:id/messages", validate(CreateMessageBody), async (req, res) => {
  const ticket = await tickets.addMessage(currentUser(req), param(req, "id"), res.locals.body);
  res.status(201).json({ data: ticket });
});

/** POST /api/tickets/:id/notes - admin-only internal note */
ticketsRouter.post("/:id/notes", adminOnly, validate(CreateNoteBody), async (req, res) => {
  const ticket = await tickets.addNote(currentUser(req), param(req, "id"), res.locals.body);
  res.status(201).json({ data: ticket });
});

/** GET /api/tickets/:id/draft - AI draft reply (cached; generated on first request) */
ticketsRouter.get("/:id/draft", adminOnly, async (req, res) => {
  const result = await getOrCreateDraft(param(req, "id"));
  res.json({ data: result.draft, fallbackReason: result.fallbackReason, ai: aiStatus() });
});

/** POST /api/tickets/:id/draft/regenerate - force a fresh AI draft */
ticketsRouter.post("/:id/draft/regenerate", adminOnly, async (req, res) => {
  const result = await getOrCreateDraft(param(req, "id"), { regenerate: true });
  res.json({ data: result.draft, fallbackReason: result.fallbackReason, ai: aiStatus() });
});

/** POST /api/tickets/:id/classify - re-run classification (e.g. after an AI outage) */
ticketsRouter.post("/:id/classify", adminOnly, async (req, res) => {
  const exists = await prisma.ticket.count({ where: { id: param(req, "id") } });
  if (!exists) throw notFound("Ticket");
  await classifyTicket(param(req, "id"));
  res.json({ data: await tickets.getTicket(currentUser(req), param(req, "id")) });
});

/** GET /api/tickets/:id/attachments/:attachmentId - download (same access rules as the ticket) */
ticketsRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const file = await tickets.getAttachment(currentUser(req), param(req, "id"), param(req, "attachmentId"));
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
  res.sendFile(path.join(UPLOAD_ROOT, file.storageKey), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: { code: "NOT_FOUND", message: "File no longer available" } });
  });
});
