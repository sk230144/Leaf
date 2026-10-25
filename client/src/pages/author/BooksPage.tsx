import { Link } from "react-router-dom";
import { useBooks } from "../../api/hooks";
import type { Book, RoyaltySchedule } from "../../api/types";
import { useUser } from "../../auth/AuthContext";
import { EmptyState, ErrorBanner, PageHeader, PageLoader, Stat } from "../../components/ui";
import { formatDate, formatInr } from "../../lib/format";

const STAGES = [
  "Manuscript",
  "Editing",
  "Cover Design",
  "Typesetting",
  "Proofreading",
  "ISBN",
  "Printing",
  "Distribution",
  "Live",
];

function ProductionTracker({ book }: { book: Book }) {
  return (
    <div>
      <div className="mb-2 text-sm text-slate-600">
        Currently in <span className="font-semibold text-slate-900">{book.stageLabel}</span> · stage {book.stageIndex + 1} of {STAGES.length}
      </div>
      <ol className="flex gap-1">
        {STAGES.map((stage, index) => (
          <li key={stage} className="flex-1" title={stage}>
            <div
              className={`h-1.5 rounded-full ${index < book.stageIndex ? "bg-brand-500" : index === book.stageIndex ? "animate-pulse bg-amber-400" : "bg-slate-200"}`}
            />
            <div className={`mt-1 hidden text-[10px] lg:block ${index === book.stageIndex ? "font-semibold text-slate-700" : "text-slate-400"}`}>
              {stage}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Sales and royalties will appear here once your book is published. We email you at every stage.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function RoyaltyNote({ book, schedule }: { book: Book; schedule: RoyaltySchedule }) {
  if (book.royaltyPending === 0) {
    return <p className="text-xs text-emerald-700">All royalties paid to date.</p>;
  }
  if (book.royaltyPending < schedule.payoutThreshold) {
    return (
      <p className="text-xs text-slate-500">
        {formatInr(book.royaltyPending)} is below the {formatInr(schedule.payoutThreshold)} payout threshold and rolls over to the next quarter.
      </p>
    );
  }
  return (
    <p className="text-xs text-slate-500">
      Royalties for {schedule.nextPayoutQuarter} are paid by {formatDate(schedule.nextPayoutBy)}.
    </p>
  );
}

function BookCard({ book, schedule }: { book: Book; schedule: RoyaltySchedule }) {
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{book.title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {book.genre} · ISBN {book.isbn}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${book.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
          >
            {book.isPublished ? "Published & Live" : `In Production · ${book.stageLabel}`}
          </span>
          <Link to={`/tickets/new?bookId=${book.id}`} className="btn-ghost px-2 py-1 text-xs">
            Get help
          </Link>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        {book.isPublished ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Published" value={formatDate(book.publicationDate)} />
              <Field label="MRP" value={formatInr(book.mrp)} />
              <Field label="Copies sold" value={book.copiesSold.toLocaleString("en-IN")} />
              <Field label="Royalty earned" value={formatInr(book.royaltyEarned)} />
              <Field label="Royalty paid" value={formatInr(book.royaltyPaid)} />
              <Field
                label="Royalty pending"
                value={<span className={book.royaltyPending > 0 ? "text-orange-600" : ""}>{formatInr(book.royaltyPending)}</span>}
              />
              <Field label="Last payout" value={book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : "Not yet"} />
            </dl>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <RoyaltyNote book={book} schedule={schedule} />
              <div className="flex flex-wrap gap-1">
                {book.availableOn.map((platform) => (
                  <span key={platform} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {platform}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <ProductionTracker book={book} />
        )}
      </div>
    </article>
  );
}

export function BooksPage() {
  const user = useUser();
  const { data, isLoading, error } = useBooks();

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorBanner error={error} />;

  const published = data.data.filter((b) => b.isPublished).length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        subtitle={`${data.data.length} book${data.data.length === 1 ? "" : "s"} · ${published} published`}
        actions={
          <Link to="/tickets/new" className="btn-primary">
            Raise a support query
          </Link>
        }
      />

      {data.data.length === 0 ? (
        <EmptyState title="No books yet" description="Once your manuscript is received it will appear here with live production status." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Copies sold" value={data.totals.copiesSold.toLocaleString("en-IN")} />
            <Stat label="Royalty earned" value={formatInr(data.totals.royaltyEarned)} />
            <Stat label="Royalty paid" value={formatInr(data.totals.royaltyPaid)} tone="good" />
            <Stat
              label="Royalty pending"
              value={formatInr(data.totals.royaltyPending)}
              tone={data.totals.royaltyPending > 0 ? "warn" : "default"}
              hint={`Next payout: ${data.royaltySchedule.nextPayoutQuarter}, by ${formatDate(data.royaltySchedule.nextPayoutBy)}`}
            />
          </div>
          <div className="space-y-4">
            {data.data.map((book) => (
              <BookCard key={book.id} book={book} schedule={data.royaltySchedule} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
