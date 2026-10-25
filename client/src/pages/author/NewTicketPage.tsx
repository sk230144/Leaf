import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/http";
import { useBooks, useCreateTicket } from "../../api/hooks";
import { PageHeader, Spinner } from "../../components/ui";
import { formatBytes } from "../../lib/format";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ".png,.jpg,.jpeg,.webp,.pdf";
const DESCRIPTION_MAX = 5000;

export function NewTicketPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const books = useBooks();
  const createTicket = useCreateTicket();
  const fileInput = useRef<HTMLInputElement>(null);

  const [bookId, setBookId] = useState(params.get("bookId") ?? "general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onFileChange(selected: File | null) {
    setErrors((prev) => ({ ...prev, attachment: "" }));
    if (selected && selected.size > MAX_FILE_BYTES) {
      setErrors((prev) => ({ ...prev, attachment: "File is larger than 5 MB" }));
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(selected);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const form = new FormData();
    form.set("bookId", bookId);
    form.set("subject", subject);
    form.set("description", description);
    if (file) form.set("attachment", file);

    try {
      const { data } = await createTicket.mutateAsync(form);
      navigate(`/tickets/${data.id}`, { state: { justCreated: true } });
    } catch (error) {
      if (error instanceof ApiError && error.details) setErrors(error.fieldErrors());
      else setFormError(error instanceof Error ? error.message : "Could not submit your query");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Raise a support query" subtitle="Our team typically responds within one business day." />

      <form onSubmit={onSubmit} className="card space-y-5 p-6" noValidate>
        <div>
          <label className="label" htmlFor="book">Which book is this about?</label>
          <select id="book" className="input" value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={books.isLoading}>
            <option value="general">General / Account level</option>
            {books.data?.data.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
                {book.isPublished ? "" : ` (in production — ${book.stageLabel})`}
              </option>
            ))}
          </select>
          {errors.bookId && <p className="mt-1 text-sm text-red-600">{errors.bookId}</p>}
        </div>

        <div>
          <label className="label" htmlFor="subject">Subject</label>
          <input
            id="subject"
            className="input"
            maxLength={150}
            placeholder="e.g. Royalty for last quarter not received"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          {errors.subject && <p className="mt-1 text-sm text-red-600">{errors.subject}</p>}
        </div>

        <div>
          <label className="label" htmlFor="description">Describe the issue</label>
          <textarea
            id="description"
            className="input min-h-40"
            maxLength={DESCRIPTION_MAX}
            placeholder="Include anything that helps us act quickly — dates, platforms, amounts, what you expected to happen."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-red-600">{errors.description}</span>
            <span className="text-slate-400">
              {description.length}/{DESCRIPTION_MAX}
            </span>
          </div>
        </div>

        <div>
          <span className="label">Attachment <span className="font-normal text-slate-400">(optional)</span></span>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3">
            <input
              ref={fileInput}
              id="attachment"
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
            <label htmlFor="attachment" className="btn-secondary cursor-pointer py-1.5">
              Choose file
            </label>
            {file ? (
              <span className="flex items-center gap-2 text-sm text-slate-700">
                {file.name} <span className="text-slate-400">({formatBytes(file.size)})</span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    setFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  aria-label="Remove attachment"
                >
                  ✕
                </button>
              </span>
            ) : (
              <span className="text-sm text-slate-400">PNG, JPG, WEBP or PDF up to 5 MB — e.g. photos of a misprint</span>
            )}
          </div>
          {errors.attachment && <p className="mt-1 text-sm text-red-600">{errors.attachment}</p>}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
          <Link to="/tickets" className="btn-secondary">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={createTicket.isPending}>
            {createTicket.isPending && <Spinner />} Submit query
          </button>
        </div>
      </form>
    </div>
  );
}
