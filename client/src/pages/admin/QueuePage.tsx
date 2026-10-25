import { useNavigate, useSearchParams } from "react-router-dom";
import { useAdminTickets, useStats, type TicketFilters } from "../../api/hooks";
import type { AdminStats, AdminTicketSummary } from "../../api/types";
import { EmptyState, ErrorBanner, PageHeader, PageLoader, PriorityBadge, SourceTag, Stat, StatusBadge } from "../../components/ui";
import { CATEGORY_OPTIONS } from "../../lib/labels";
import { age, hoursSince } from "../../lib/format";

const STATUS_TABS = [
  { label: "Active", value: "OPEN,IN_PROGRESS" },
  { label: "Open", value: "OPEN" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
  { label: "All", value: "" },
];

/** Hours an unanswered ticket can wait before it is flagged as overdue. */
const SLA_HOURS = 24;

function AiStatusCard({ ai }: { ai: AdminStats["ai"] }) {
  const usage = ai.last30Days;
  const state = !ai.enabled ? ["Disabled", "bg-slate-400"] : ai.available ? ["Online", "bg-emerald-500"] : ["Paused", "bg-amber-400"];
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        AI assistant
        <span className="flex items-center gap-1.5 normal-case">
          <span className={`h-2 w-2 rounded-full ${state[1]}`} /> {state[0]}
        </span>
      </div>
      <div className="mt-1 text-sm text-slate-700">
        {ai.enabled ? (
          <>
            {usage.calls} calls · ${usage.estimatedCostUsd.toFixed(3)} · {Math.round(usage.cacheHitRate * 100)}% cached
          </>
        ) : (
          "Rule-based triage & templates"
        )}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {ai.quality.draftAdoptionRate !== null ? `${Math.round(ai.quality.draftAdoptionRate * 100)}% of replies AI-assisted · ` : ""}
        {ai.quality.categoryOverrides} category overrides
      </div>
    </div>
  );
}

function StatsStrip({ stats }: { stats: AdminStats }) {
  const t = stats.tickets;
  const urgent = (t.activeByPriority.CRITICAL ?? 0) + (t.activeByPriority.HIGH ?? 0);
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Stat label="Open" value={t.byStatus.OPEN ?? 0} hint={`${t.byStatus.IN_PROGRESS ?? 0} in progress`} />
      <Stat label="Critical + High" value={urgent} tone={urgent ? "warn" : "default"} hint={`${t.activeByPriority.CRITICAL ?? 0} critical`} />
      <Stat label="Awaiting first reply" value={t.awaitingFirstResponse} tone={t.awaitingFirstResponse ? "warn" : "good"} />
      <Stat label="Unassigned" value={t.unassignedActive} hint={t.oldestActiveCreatedAt ? `Oldest active: ${age(t.oldestActiveCreatedAt)}` : undefined} />
      <AiStatusCard ai={stats.ai} />
    </div>
  );
}

function AgeCell({ ticket }: { ticket: AdminTicketSummary }) {
  const active = ticket.status === "OPEN" || ticket.status === "IN_PROGRESS";
  const overdue = active && ticket.awaitingSupport && hoursSince(ticket.lastActivityAt) > SLA_HOURS;
  return (
    <span className={overdue ? "font-semibold text-red-600" : "text-slate-500"} title={overdue ? `Waiting on us for more than ${SLA_HOURS}h` : undefined}>
      {age(ticket.createdAt)}
      {overdue && " ⚠"}
    </span>
  );
}

export function QueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL so a filtered view can be bookmarked or shared.
  const filters: TicketFilters = {
    status: params.get("status") ?? "OPEN,IN_PROGRESS",
    category: params.get("category") ?? "",
    priority: params.get("priority") ?? "",
    assignee: params.get("assignee") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    q: params.get("q") ?? "",
    sort: params.get("sort") ?? "urgency",
    page: Number(params.get("page") ?? 1),
  };
  const setFilter = (key: keyof TicketFilters, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const stats = useStats();
  const { data, isLoading, error, isFetching } = useAdminTickets({
    ...filters,
    // `to` is a date; include the whole day
    to: filters.to ? `${filters.to}T23:59:59` : "",
  });

  return (
    <>
      <PageHeader title="Ticket queue" subtitle="Sorted by urgency: highest priority first, then oldest." />
      {stats.data && <StatsStrip stats={stats.data} />}

      <div className="card mb-4 p-3">
        <div className="mb-3 flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setFilter("status", tab.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${filters.status === tab.value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {tab.label}
              {tab.value && stats.data && !tab.value.includes(",") && (
                <span className="ml-1.5 opacity-70">{stats.data.tickets.byStatus[tab.value as keyof AdminStats["tickets"]["byStatus"]] ?? 0}</span>
              )}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <input className="input xl:col-span-2" placeholder="Search subject, author, BL-1001…" defaultValue={filters.q} onKeyDown={(e) => e.key === "Enter" && setFilter("q", e.currentTarget.value)} onBlur={(e) => e.target.value !== filters.q && setFilter("q", e.target.value)} />
          <select className="input" value={filters.category} onChange={(e) => setFilter("category", e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select className="input" value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Priority">
            <option value="">All priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL,HIGH">Critical + High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select className="input" value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} aria-label="Created from" title="Created from" />
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} aria-label="Created to" title="Created to" />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <label className="flex items-center gap-2">
            Sort
            <select className="rounded border border-slate-200 px-1.5 py-0.5" value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)}>
              <option value="urgency">Urgency</option>
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
          {isFetching && <span>Refreshing…</span>}
        </div>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorBanner error={error} />
      ) : data.data.length === 0 ? (
        <EmptyState title="Nothing here" description="No tickets match these filters. Inbox zero!" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Assignee</th>
                <th className="px-4 py-2.5 font-medium">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => navigate(`/admin/tickets/${ticket.id}`)}
                  className={`cursor-pointer hover:bg-slate-50 ${ticket.priority === "CRITICAL" && ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" ? "bg-red-50/60" : ""}`}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-1.5">
                      <PriorityBadge priority={ticket.priority} />
                      <SourceTag source={ticket.prioritySource} />
                    </div>
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      {ticket.awaitingSupport && ticket.status !== "CLOSED" && ticket.status !== "RESOLVED" && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" title="Awaiting our reply" />
                      )}
                      <span className="truncate font-medium text-slate-900">{ticket.subject}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {ticket.reference} · {ticket.author.name} · {ticket.book?.title ?? "General / Account"}
                      {ticket.hasAttachment && " · 📎"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                      {ticket.categoryLabel ?? <span className="italic text-slate-400">classifying…</span>}
                      <SourceTag source={ticket.categorySource} />
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={ticket.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{ticket.assignee?.name ?? <span className="text-slate-400">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3"><AgeCell ticket={ticket} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm text-slate-600">
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.total} tickets
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary py-1" disabled={data.pagination.page <= 1} onClick={() => setFilter("page", String(data.pagination.page - 1))}>Previous</button>
                <button className="btn-secondary py-1" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setFilter("page", String(data.pagination.page + 1))}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
