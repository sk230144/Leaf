import type { ReactNode } from "react";
import type { ClassificationSource, TicketPriority, TicketStatus } from "../api/types";

const STATUS_STYLES: Record<TicketStatus, string> = {
  OPEN: "bg-sky-50 text-sky-700 ring-sky-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-200",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  CRITICAL: "bg-red-600 text-white ring-red-600",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-300",
  MEDIUM: "bg-yellow-50 text-yellow-800 ring-yellow-200",
  LOW: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function PriorityBadge({ priority }: { priority: TicketPriority | null }) {
  if (!priority) return <span className="text-xs italic text-slate-400">classifying…</span>;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_STYLES[priority]}`}>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </span>
  );
}

/** Small tag showing who decided a classification: the AI, fallback rules, or an admin. */
export function SourceTag({ source }: { source: ClassificationSource | null }) {
  if (!source) return null;
  const styles: Record<ClassificationSource, [string, string]> = {
    AI: ["AI", "bg-violet-50 text-violet-700"],
    RULES: ["Rules", "bg-slate-100 text-slate-600"],
    ADMIN: ["Manual", "bg-brand-50 text-brand-700"],
  };
  const [label, cls] = styles[source];
  return <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-20 text-brand-600">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-2xl">📖</div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "warn" | "good" }) {
  const toneCls = { default: "text-slate-900", warn: "text-orange-600", good: "text-emerald-600" }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
