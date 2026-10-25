import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for ticket changes, fanned out to browsers over SSE.
 *
 * Events are deliberately thin ("ticket X changed") - clients refetch through
 * the normal REST endpoints, so authorization logic lives in one place and a
 * missed event can never leave a client with stale partial data.
 *
 * Single-instance only: running several server replicas would need this
 * swapped for Redis/Postgres LISTEN-NOTIFY. See README "Known limitations".
 */
export type TicketEventName =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.message" // public reply (author-visible)
  | "ticket.internal"; // note / draft / assignment - admins only

export interface TicketEvent {
  type: TicketEventName;
  ticketId: string;
  /** Owner of the ticket - used to route events to the right author */
  authorId: string;
  /** Admin-only events are never delivered to authors */
  adminOnly: boolean;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per connected browser tab

const CHANNEL = "ticket-event";

export function publish(type: TicketEventName, ticket: { id: string; authorId: string }) {
  const event: TicketEvent = {
    type,
    ticketId: ticket.id,
    authorId: ticket.authorId,
    adminOnly: type === "ticket.internal",
  };
  emitter.emit(CHANNEL, event);
}

export function subscribe(listener: (event: TicketEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}
