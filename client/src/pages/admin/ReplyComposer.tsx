import { useEffect, useState } from "react";
import { useAddNote, useDraft, useRegenerateDraft, useReply } from "../../api/hooks";
import type { AdminTicketDetail, Draft, TicketStatus } from "../../api/types";
import { ErrorBanner, Spinner } from "../../components/ui";

const FALLBACK_REASONS: Record<string, string> = {
  disabled: "AI is not configured on this server",
  circuit_open: "AI paused after repeated errors — retrying automatically soon",
  rate_limited: "AI provider rate limit reached",
  unavailable: "AI provider is temporarily unavailable",
  auth: "AI provider rejected the API key",
  refused: "The AI declined to draft this reply",
  invalid_output: "The AI returned an incomplete draft",
};

/** Unfilled "[placeholder]" markers the AI leaves for facts it doesn't have. */
const PLACEHOLDER = /\[[^\]\n]{3,}\]/g;

function DraftBanner({ draft, fallbackReason, onRegenerate, regenerating }: {
  draft: Draft;
  fallbackReason: string | null;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const isAi = draft.source === "AI";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${isAi ? "bg-violet-50 text-violet-800" : "bg-slate-100 text-slate-700"}`}>
      <span>
        {isAi ? (
          <>✨ AI draft based on the BookLeaf knowledge base and this author's account — review before sending.</>
        ) : (
          <>Template draft loaded{fallbackReason ? ` (${FALLBACK_REASONS[fallbackReason] ?? fallbackReason})` : ""} — please personalise it.</>
        )}
      </span>
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onRegenerate} disabled={regenerating}>
        {regenerating ? <Spinner className="h-3 w-3" /> : "↻"} Regenerate
      </button>
    </div>
  );
}

export function ReplyComposer({ ticket }: { ticket: AdminTicketDetail }) {
  const draft = useDraft(ticket.id, true);
  const regenerate = useRegenerateDraft(ticket.id);
  const reply = useReply(ticket.id);
  const addNote = useAddNote(ticket.id);

  const [body, setBody] = useState("");
  const [loadedDraftVersion, setLoadedDraftVersion] = useState<string | null>(null);
  const [fromDraft, setFromDraft] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [nextStatus, setNextStatus] = useState<TicketStatus | "">("");
  const [escalationNoted, setEscalationNoted] = useState(false);

  const current = draft.data?.data;
  const version = current ? `${current.id}:${current.updatedAt}` : null;
  const newDraftAvailable = version !== null && version !== loadedDraftVersion;

  function loadDraft(d: Draft) {
    setBody(d.content);
    setFromDraft(true);
    setDirty(false);
    setLoadedDraftVersion(`${d.id}:${d.updatedAt}`);
    setNextStatus(d.suggestedStatus ?? "");
    setEscalationNoted(false);
  }

  // Auto-load a fresh draft unless the admin is mid-edit.
  useEffect(() => {
    if (current && newDraftAvailable && !dirty) loadDraft(current);
  }, [version]);

  const placeholders = body.match(PLACEHOLDER) ?? [];

  async function send() {
    if (placeholders.length > 0 && !window.confirm(`The reply still contains ${placeholders.length} placeholder(s) like ${placeholders[0]}. Send anyway?`)) return;
    await reply.mutateAsync({ body, status: nextStatus || undefined, fromAiDraft: fromDraft });
    setBody("");
    setDirty(false);
    setFromDraft(false);
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Reply to {ticket.author.name.split(" ")[0]}</h2>
        {current && <span className="text-xs text-slate-400">{current.model ?? "template"}</span>}
      </div>

      <div className="space-y-3">
        {draft.isLoading && (
          <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
            <Spinner className="h-3 w-3" /> Drafting a reply from the knowledge base…
          </div>
        )}
        {draft.error && <ErrorBanner error={draft.error} />}
        {current && draft.data && (
          <DraftBanner
            draft={current}
            fallbackReason={draft.data.fallbackReason}
            onRegenerate={() => {
              if (dirty && !window.confirm("Replace your edits with a new draft?")) return;
              setDirty(false);
              regenerate.mutate();
            }}
            regenerating={regenerate.isPending}
          />
        )}
        {current && newDraftAvailable && dirty && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A newer draft is available (the thread changed).
            <button type="button" className="font-medium underline" onClick={() => loadDraft(current)}>Use new draft</button>
          </div>
        )}

        {current?.source === "AI" && current.missingInfo.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">Verify before sending:</p>
            <ul className="mt-1 list-disc pl-5">
              {current.missingInfo.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}

        {current?.needsEscalation && current.escalationNote && (
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
            <span><span className="font-medium">Escalation suggested:</span> {current.escalationNote}</span>
            <button
              type="button"
              className="text-xs font-medium underline disabled:no-underline disabled:opacity-60"
              disabled={escalationNoted || addNote.isPending}
              onClick={async () => {
                await addNote.mutateAsync({ body: `Escalation: ${current.escalationNote}` });
                setEscalationNoted(true);
              }}
            >
              {escalationNoted ? "Added to notes ✓" : "Save as internal note"}
            </button>
          </div>
        )}

        <textarea
          className="input min-h-64 font-[inherit] leading-relaxed"
          value={body}
          maxLength={5000}
          placeholder={draft.isLoading ? "Waiting for draft… you can also start typing." : "Write a reply to the author…"}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
            if (!e.target.value.trim()) setFromDraft(false);
          }}
        />
        {placeholders.length > 0 && (
          <p className="text-xs text-amber-700">{placeholders.length} placeholder(s) to fill in: {placeholders.slice(0, 3).join(", ")}</p>
        )}

        <ErrorBanner error={reply.error} />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Then set status
            <select className="input w-auto py-1.5" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as TicketStatus | "")}>
              <option value="">{ticket.status === "OPEN" ? "In Progress (default)" : "Keep current"}</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
          <button className="btn-primary" disabled={!body.trim() || reply.isPending} onClick={send}>
            {reply.isPending && <Spinner />} Send to author
          </button>
        </div>
      </div>
    </section>
  );
}
