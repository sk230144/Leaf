import type { Book } from "@prisma/client";

/** Royalty rules from the BookLeaf knowledge base. */
export const ROYALTY_PAYOUT_THRESHOLD = 1000;
export const ROYALTY_PAYOUT_WINDOW_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface RoyaltySchedule {
  /** The most recent quarter whose royalties are being/have been paid out */
  quarterLabel: string;
  quarterEnd: Date;
  payoutDeadline: Date;
}

const QUARTER_NAMES = ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"];

/**
 * The next payout an author should expect as of `today`: royalties are
 * calculated per calendar quarter and paid within 45 days of quarter end.
 * If the last completed quarter's window is still open, that is the next
 * payout; otherwise it is the current quarter's.
 */
export function upcomingRoyaltyPayout(today: Date): RoyaltySchedule {
  const year = today.getUTCFullYear();
  const quarter = Math.floor(today.getUTCMonth() / 3);

  // End of the last completed quarter (day 0 = last day of previous month)
  const lastQuarterEnd = utcDate(year, quarter * 3, 0);
  const lastDeadline = addDays(lastQuarterEnd, ROYALTY_PAYOUT_WINDOW_DAYS);
  if (today.getTime() <= lastDeadline.getTime()) {
    const lastQuarterIndex = (quarter + 3) % 4;
    return {
      quarterLabel: `${QUARTER_NAMES[lastQuarterIndex]} ${lastQuarterEnd.getUTCFullYear()}`,
      quarterEnd: lastQuarterEnd,
      payoutDeadline: lastDeadline,
    };
  }

  const currentQuarterEnd = utcDate(year, quarter * 3 + 3, 0);
  return {
    quarterLabel: `${QUARTER_NAMES[quarter]} ${year}`,
    quarterEnd: currentQuarterEnd,
    payoutDeadline: addDays(currentQuarterEnd, ROYALTY_PAYOUT_WINDOW_DAYS),
  };
}

/**
 * A healthy account with royalties above the threshold is paid at least once
 * per cycle (one quarter + the 45-day window, ~135 days). If the last payout
 * (or publication, if never paid) is older than that, a payout was probably
 * missed and the case should be verified and owned, not explained away.
 */
export const OVERDUE_AFTER_DAYS = 140;

export function isPayoutOverdueSuspected(book: Book, today: Date): boolean {
  if (book.royaltyPending < ROYALTY_PAYOUT_THRESHOLD) return false;
  const reference = book.lastRoyaltyPayoutDate ?? book.publicationDate;
  if (!reference) return false;
  return today.getTime() - reference.getTime() > OVERDUE_AFTER_DAYS * DAY_MS;
}

