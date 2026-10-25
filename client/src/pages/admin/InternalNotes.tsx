import { useState, type FormEvent } from "react";
import { useAddNote } from "../../api/hooks";
import type { AdminTicketDetail } from "../../api/types";
import { ErrorBanner, Spinner } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

export function InternalNotes({ ticket }: { ticket: AdminTicketDetail }) {
  const addNote = useAddNote(ticket.id);
  const [body, setBody] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await addNote.mutateAsync({ body });
    setBody("");
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
      <h2 className="font-semibold text-slate-900">
        Internal notes <span className="text-xs font-normal text-amber-700">· never visible to the author</span>
      </h2>
      {ticket.notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {ticket.notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-amber-100">
              <div className="mb-0.5 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{note.adminName}</span> · {formatDateTime(note.createdAt)}
              </div>
              <p className="whitespace-pre-wrap text-slate-800">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input className="input" placeholder="Add a note for the team…" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        <button className="btn-secondary shrink-0" disabled={!body.trim() || addNote.isPending}>
          {addNote.isPending && <Spinner />} Add note
        </button>
      </form>
      <div className="mt-2"><ErrorBanner error={addNote.error} /></div>
    </section>
  );
}
