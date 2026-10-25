import { useState } from "react";
import { Link } from "react-router-dom";
import { useTickets } from "../../api/hooks";
import { EmptyState, ErrorBanner, PageHeader, PageLoader, StatusBadge } from "../../components/ui";
import { relativeTime } from "../../lib/format";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Active", value: "OPEN,IN_PROGRESS" },
  { label: "Resolved", value: "RESOLVED,CLOSED" },
];

export function MyTicketsPage() {
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useTickets({ status, sort: "updated" });

  return (
    <>
      <PageHeader
        title="My tickets"
        subtitle="Replies from our team appear here instantly."
        actions={<Link to="/tickets/new" className="btn-primary">New query</Link>}
      />

      <div className="mb-4 flex gap-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setStatus(filter.value)}
            className={`rounded-full px-3 py-1 text-sm ${status === filter.value ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorBanner error={error} />
      ) : data.data.length === 0 ? (
        <EmptyState
          title={status ? "No tickets match this filter" : "You haven't raised any queries yet"}
          description="Questions about royalties, ISBNs, printing or your book's progress? We're here to help."
          action={<Link to="/tickets/new" className="btn-primary">Raise a support query</Link>}
        />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {data.data.map((ticket) => {
            const hasNewReply = !ticket.awaitingSupport && ticket.status !== "CLOSED";
            return (
              <li key={ticket.id}>
                <Link to={`/tickets/${ticket.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400">{ticket.reference}</span>
                      {hasNewReply && <span className="rounded bg-brand-50 px-1.5 py-px text-[10px] font-semibold uppercase text-brand-700">Reply from BookLeaf</span>}
                    </div>
                    <p className="mt-0.5 truncate font-medium text-slate-900">{ticket.subject}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {ticket.book?.title ?? "General / Account"} · {ticket.messageCount} {ticket.messageCount === 1 ? "reply" : "replies"} · updated{" "}
                      {relativeTime(ticket.lastActivityAt)}
                    </p>
                  </div>
                  <StatusBadge status={ticket.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
