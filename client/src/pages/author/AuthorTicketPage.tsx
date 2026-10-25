import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useReply, useTicket } from "../../api/hooks";
import { ErrorBanner, PageLoader, Spinner, StatusBadge } from "../../components/ui";
import { Thread } from "../../components/Thread";
import { formatDate } from "../../lib/format";

const STATUS_HELP = {
  OPEN: "Our team has received your query and will respond shortly.",
  IN_PROGRESS: "Our team is working on this. You'll see updates here as soon as they're posted.",
  RESOLVED: "We believe this is resolved. Reply below if you need anything else and we'll reopen it.",
  CLOSED: "This ticket is closed. Please raise a new query if you need more help.",
};

export function AuthorTicketPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated;
  const { data: ticket, isLoading, error } = useTicket(id);
  const reply = useReply(id);
  const [body, setBody] = useState("");

  if (isLoading) return <PageLoader />;
  if (error || !ticket) return <ErrorBanner error={error ?? new Error("Ticket not found")} />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    await reply.mutateAsync({ body });
    setBody("");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/tickets" className="text-sm text-brand-600 hover:underline">← All tickets</Link>

      {justCreated && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Thanks — your query {ticket.reference} has been received. You'll see our reply here without needing to refresh.
        </div>
      )}

      <div className="mb-6 mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{ticket.subject}</h1>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {ticket.reference} · {ticket.book?.title ?? "General / Account"} · opened {formatDate(ticket.createdAt)}
        </p>
        <p className="mt-2 text-sm text-slate-600">{STATUS_HELP[ticket.status]}</p>
      </div>

      <Thread ticket={ticket} viewer="AUTHOR" />

      {ticket.status !== "CLOSED" && (
        <form onSubmit={onSubmit} className="card mt-6 p-4">
          <label htmlFor="reply" className="label">Add a reply</label>
          <textarea
            id="reply"
            className="input min-h-24"
            maxLength={5000}
            placeholder="Add more details or answer a question from our team…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <ErrorBanner error={reply.error} />
          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={reply.isPending || !body.trim()}>
              {reply.isPending && <Spinner />} Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
