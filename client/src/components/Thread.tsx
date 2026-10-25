import type { TicketDetail } from "../api/types";
import { formatBytes, formatDateTime } from "../lib/format";

interface Props {
  ticket: TicketDetail;
  /** Whose perspective: the author sees "You", admins see the author's name */
  viewer: "AUTHOR" | "ADMIN";
  authorName?: string;
}

function Bubble({ fromSupport, name, time, body, tag }: { fromSupport: boolean; name: string; time: string; body: string; tag?: string }) {
  return (
    <div className={`flex ${fromSupport ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${fromSupport ? "bg-brand-50 ring-1 ring-brand-100" : "bg-white ring-1 ring-slate-200"}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">{name}</span>
          <span className="text-slate-400">{formatDateTime(time)}</span>
          {tag && <span className="rounded bg-violet-50 px-1.5 text-[10px] font-medium text-violet-700">{tag}</span>}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{body}</p>
      </div>
    </div>
  );
}

export function Thread({ ticket, viewer, authorName }: Props) {
  const authorLabel = viewer === "AUTHOR" ? "You" : (authorName ?? "Author");
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{authorLabel}</span>
          <span>{formatDateTime(ticket.createdAt)}</span>
          <span>· original query</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{ticket.description}</p>
        {ticket.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {ticket.attachments.map((file) => (
              <a
                key={file.id}
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-brand-700 hover:bg-slate-50"
              >
                📎 {file.name} <span className="text-xs text-slate-400">{formatBytes(file.sizeBytes)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {ticket.messages.map((message) => {
        const fromSupport = message.senderRole === "ADMIN";
        const name = fromSupport ? `${message.senderName} · BookLeaf Support` : authorLabel;
        const tag = viewer === "ADMIN" && message.fromAiDraft ? "AI-assisted" : undefined;
        return <Bubble key={message.id} fromSupport={fromSupport} name={name} time={message.createdAt} body={message.body} tag={tag} />;
      })}
    </div>
  );
}
