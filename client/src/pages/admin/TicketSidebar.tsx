import type { ReactNode } from "react";
import { useAdmins, useAiStatus, useReclassify, useUpdateTicket } from "../../api/hooks";
import type { AdminTicketDetail, TicketCategory, TicketPriority, TicketStatus } from "../../api/types";
import { useUser } from "../../auth/AuthContext";
import { ErrorBanner, SourceTag, Spinner } from "../../components/ui";
import { formatDate, formatDateTime, formatInr } from "../../lib/format";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS } from "../../lib/labels";

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{children}</span>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Ticket created",
  CLASSIFIED: "Classified",
  STATUS_CHANGED: "Status",
  CATEGORY_CHANGED: "Category overridden",
  PRIORITY_CHANGED: "Priority overridden",
  ASSIGNED: "Assignment changed",
};

export function TicketSidebar({ ticket }: { ticket: AdminTicketDetail }) {
  const me = useUser();
  const admins = useAdmins();
  const update = useUpdateTicket(ticket.id);
  const reclassify = useReclassify(ticket.id);
  const ai = useAiStatus();
  const adminName = (id: string | null) => admins.data?.find((a) => a.id === id)?.name ?? "—";
  const book = ticket.bookDetails;

  return (
    <aside className="space-y-4">
      <Panel title="Manage">
        <div className="space-y-3">
          <label className="block">
            <span className="label">Status</span>
            <select className="input" value={ticket.status} disabled={update.isPending} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })}>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="label flex items-center gap-2">
              Priority <SourceTag source={ticket.prioritySource} />
            </span>
            <select className="input" value={ticket.priority ?? ""} disabled={update.isPending} onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}>
              {!ticket.priority && <option value="">Classifying…</option>}
              {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="label flex items-center gap-2">
              Category <SourceTag source={ticket.categorySource} />
              {ticket.categorySource === "AI" && ticket.aiConfidence !== null && (
                <span className="text-xs font-normal text-slate-400">{Math.round(ticket.aiConfidence * 100)}% confident</span>
              )}
            </span>
            <select className="input" value={ticket.category ?? ""} disabled={update.isPending} onChange={(e) => update.mutate({ category: e.target.value as TicketCategory })}>
              {!ticket.category && <option value="">Classifying…</option>}
              {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="label">Assignee</span>
            <div className="flex gap-2">
              <select
                className="input"
                value={ticket.assignee?.id ?? ""}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {admins.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {ticket.assignee?.id !== me.id && (
                <button className="btn-secondary shrink-0 px-2.5" disabled={update.isPending} onClick={() => update.mutate({ assigneeId: me.id })}>
                  Take it
                </button>
              )}
            </div>
          </label>

          {ticket.aiStatus === "FAILED" && (
            <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              Classified by fallback rules because the AI was unavailable{ticket.aiError ? ` (${ticket.aiError})` : ""}.
              {ai.data?.available && (
                <button className="ml-1 font-medium text-brand-600 underline" disabled={reclassify.isPending} onClick={() => reclassify.mutate()}>
                  {reclassify.isPending ? <Spinner className="h-3 w-3" /> : "Retry with AI"}
                </button>
              )}
            </div>
          )}
          <ErrorBanner error={update.error ?? reclassify.error} />
        </div>
      </Panel>

      <Panel title="Author">
        <p className="font-medium text-slate-900">{ticket.author.name}</p>
        <p className="text-sm text-slate-500">{ticket.author.email}</p>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <Row label="Author ID">{ticket.author.id}</Row>
          <Row label="Phone">{ticket.author.phone ?? "—"}</Row>
          <Row label="City">{ticket.author.city ?? "—"}</Row>
          <Row label="Joined">{formatDate(ticket.author.joinedDate)}</Row>
        </div>
      </Panel>

      {book ? (
        <Panel title="Book">
          <p className="font-medium text-slate-900">{book.title}</p>
          <p className="text-xs text-slate-500">{book.id} · ISBN {book.isbn}</p>
          <div className="mt-2 border-t border-slate-100 pt-2">
            <Row label="Stage">{book.stageLabel}</Row>
            {book.stage === "PUBLISHED_LIVE" ? (
              <>
                <Row label="Published">{formatDate(book.publicationDate)}</Row>
                <Row label="MRP">{formatInr(book.mrp)}</Row>
                <Row label="Copies sold">{book.copiesSold.toLocaleString("en-IN")}</Row>
                <Row label="Royalty earned">{formatInr(book.royaltyEarned)}</Row>
                <Row label="Royalty paid">{formatInr(book.royaltyPaid)}</Row>
                <Row label="Royalty pending">
                  <span className={book.royaltyPending >= 1000 ? "text-orange-600" : ""}>{formatInr(book.royaltyPending)}</span>
                </Row>
                <Row label="Last payout">{book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : "Never"}</Row>
                <Row label="Print partner">{book.printPartner ?? "—"}</Row>
                <div className="mt-2 flex flex-wrap gap-1">
                  {book.availableOn.map((p) => <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p}</span>)}
                </div>
              </>
            ) : (
              <p className="pt-1 text-sm text-slate-500">In production — no sales or royalties yet.</p>
            )}
          </div>
        </Panel>
      ) : (
        <Panel title="Book">
          <p className="text-sm text-slate-500">General / account-level query.</p>
        </Panel>
      )}

      <Panel title="Activity">
        <ol className="space-y-2 text-xs">
          {ticket.events.map((event) => (
            <li key={event.id} className="flex justify-between gap-2">
              <span className="text-slate-700">
                {EVENT_LABELS[event.type] ?? event.type}
                {event.type === "ASSIGNED"
                  ? ` → ${adminName(event.toValue)}`
                  : event.toValue
                    ? ` → ${event.toValue.replaceAll("_", " ").toLowerCase()}`
                    : ""}
                {event.actorName && <span className="text-slate-400"> by {event.actorName}</span>}
              </span>
              <span className="shrink-0 text-slate-400">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </aside>
  );
}
