import { Router } from "express";
import { authenticate, currentUser } from "../middleware/auth";
import { subscribe, type TicketEvent } from "./eventBus";

const HEARTBEAT_MS = 25_000;

export const eventsRouter = Router();

/**
 * GET /api/events - Server-Sent Events stream of ticket changes.
 * Authors only receive events for their own tickets; admins receive all.
 */
eventsRouter.get("/", authenticate, (req, res) => {
  const user = currentUser(req);

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx / Render)
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);

  const canSee = (event: TicketEvent) =>
    user.role === "ADMIN" || (!event.adminOnly && event.authorId === user.authorId);

  const unsubscribe = subscribe((event) => {
    if (!canSee(event)) return;
    res.write(`event: ticket\ndata: ${JSON.stringify({ type: event.type, ticketId: event.ticketId })}\n\n`);
  });

  // Comment lines keep idle connections alive through proxies.
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
