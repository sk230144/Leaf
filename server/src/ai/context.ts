import type { Book } from "@prisma/client";
import { STAGE_LABELS, STAGE_ORDER } from "../domain/bookStages";
import { isPayoutOverdueSuspected, OVERDUE_AFTER_DAYS, ROYALTY_PAYOUT_THRESHOLD } from "../domain/royalties";

export { isPayoutOverdueSuspected, upcomingRoyaltyPayout } from "../domain/royalties";

/**
 * Deterministic facts for the prompt. Anything that is arithmetic or a date
 * calculation (next payout date, threshold checks, days in a stage) is done
 * here in code rather than left to the model - LLMs are unreliable at date
 * math, and the tone guide demands specific numbers and dates.
 */

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** Compact, labelled facts about one book for the model (and for humans in logs). */
export function describeBook(book: Book, today: Date): string {
  const lines = [`Book: "${book.title}" (ID ${book.id}, ISBN ${book.isbn}, genre: ${book.genre})`];
  const stageIndex = STAGE_ORDER.indexOf(book.stage) + 1;

  if (book.stage !== "PUBLISHED_LIVE") {
    lines.push(`- Status: IN PRODUCTION - stage ${stageIndex} of ${STAGE_ORDER.length}: ${STAGE_LABELS[book.stage]}`);
    lines.push(`- Remaining stages: ${STAGE_ORDER.slice(stageIndex).map((s) => STAGE_LABELS[s]).join(" -> ")}`);
    lines.push("- Not yet published: no sales, MRP, or royalties yet.");
    return lines.join("\n");
  }

  lines.push(`- Status: Published & Live${book.publicationDate ? ` since ${formatDate(book.publicationDate)}` : ""}`);
  if (book.mrp !== null) lines.push(`- MRP: ${formatInr(book.mrp)}; author royalty per copy: ${book.royaltyPerCopy !== null ? formatInr(book.royaltyPerCopy) : "n/a"}`);
  lines.push(`- Copies sold: ${book.copiesSold}`);
  lines.push(
    `- Royalty earned: ${formatInr(book.royaltyEarned)}; paid: ${formatInr(book.royaltyPaid)}; pending: ${formatInr(book.royaltyPending)}`,
  );
  lines.push(`- Last royalty payout: ${book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : "never paid out"}`);

  if (book.royaltyPending > 0 && book.royaltyPending < ROYALTY_PAYOUT_THRESHOLD) {
    lines.push(
      `- NOTE: pending royalty is below the ${formatInr(ROYALTY_PAYOUT_THRESHOLD)} payout threshold, so it rolls over to the next quarter (this is expected, not an error).`,
    );
  }
  if (isPayoutOverdueSuspected(book, today)) {
    lines.push(
      `- WARNING: pending royalty is above the threshold but no payout in over ${OVERDUE_AFTER_DAYS} days - a payout may have been missed. Treat as possibly BookLeaf's fault: own it and escalate to finance with a 48-hour timeline.`,
    );
  }
  lines.push(`- Available on: ${book.availableOn.length ? book.availableOn.join(", ") : "no platforms"}`);
  if (book.printPartner) lines.push(`- Print partner: ${book.printPartner}`);
  return lines.join("\n");
}

/** One-line facts for classification - enough to judge urgency, nothing more. */
export function bookTriageLine(book: Book | null, today: Date): string {
  if (!book) return "Ticket is about: General / account level (no specific book).";
  if (book.stage !== "PUBLISHED_LIVE") {
    return `Ticket is about: "${book.title}" - in production (${STAGE_LABELS[book.stage]}).`;
  }
  const parts = [
    `Ticket is about: "${book.title}" - published`,
    `royalty paid ${formatInr(book.royaltyPaid)}, pending ${formatInr(book.royaltyPending)}`,
    `last payout ${book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : "never"}`,
  ];
  if (isPayoutOverdueSuspected(book, today)) parts.push("payout possibly overdue");
  return parts.join("; ") + ".";
}

/** Truncate long free text so a pasted wall of text can't blow up token usage. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[... truncated ${text.length - maxChars} characters]`;
}
