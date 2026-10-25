import { waitUntil } from "@vercel/functions";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { classifyTicket } from "./classifier";

/**
 * Background classification queue. Ticket creation returns immediately and
 * classification happens here, so a slow or failing AI never blocks an
 * author from submitting a ticket.
 *
 * In-memory with bounded concurrency is enough for a single instance; tickets
 * left PENDING by a restart are re-queued on boot. On serverless (Vercel),
 * each job is registered with `waitUntil` so the function stays alive until
 * the job finishes even though the HTTP response has already been sent
 * (outside Vercel `waitUntil` is a no-op). A multi-instance deploy would move
 * this to a durable queue (BullMQ / pg-boss).
 */
const CONCURRENCY = 2;
const queue: { ticketId: string; done: () => void }[] = [];
const queued = new Set<string>();
let running = 0;

export function enqueueClassification(ticketId: string) {
  if (queued.has(ticketId)) return;
  queued.add(ticketId);
  waitUntil(new Promise<void>((done) => queue.push({ ticketId, done })));
  drain();
}

function drain() {
  while (running < CONCURRENCY && queue.length > 0) {
    const { ticketId, done } = queue.shift()!;
    running += 1;
    classifyTicket(ticketId)
      .catch((error) => logger.error("Classification job failed", { ticketId, error: String(error) }))
      .finally(() => {
        running -= 1;
        queued.delete(ticketId);
        done();
        drain();
      });
  }
}

export async function requeuePendingClassifications() {
  const pending = await prisma.ticket.findMany({ where: { aiStatus: "PENDING" }, select: { id: true } });
  pending.forEach((ticket) => enqueueClassification(ticket.id));
  if (pending.length) logger.info("Re-queued pending classifications", { count: pending.length });
}
