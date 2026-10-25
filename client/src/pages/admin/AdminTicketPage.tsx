import { Link, useParams } from "react-router-dom";
import { useAdminTicket } from "../../api/hooks";
import { ErrorBanner, PageLoader, StatusBadge } from "../../components/ui";
import { Thread } from "../../components/Thread";
import { formatDate } from "../../lib/format";
import { ReplyComposer } from "./ReplyComposer";
import { InternalNotes } from "./InternalNotes";
import { TicketSidebar } from "./TicketSidebar";

export function AdminTicketPage() {
  const { id = "" } = useParams();
  const { data: ticket, isLoading, error } = useAdminTicket(id);

  if (isLoading) return <PageLoader />;
  if (error || !ticket) return <ErrorBanner error={error ?? new Error("Ticket not found")} />;

  return (
    <>
      <Link to="/admin/tickets" className="text-sm text-brand-600 hover:underline">← Back to queue</Link>

      <div className="mb-6 mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{ticket.subject}</h1>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {ticket.reference} · {ticket.author.name} · {ticket.book?.title ?? "General / Account"} · opened {formatDate(ticket.createdAt)}
        </p>
        {ticket.aiSummary && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-violet-50 px-2.5 py-1 text-sm text-violet-800">
            <span className="text-xs font-semibold uppercase">Triage</span> {ticket.aiSummary}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Thread ticket={ticket} viewer="ADMIN" authorName={ticket.author.name} />
          <ReplyComposer ticket={ticket} />
          <InternalNotes ticket={ticket} />
        </div>
        <TicketSidebar ticket={ticket} />
      </div>
    </>
  );
}
