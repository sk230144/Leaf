import type { Book, TicketCategory, TicketPriority } from "@prisma/client";
import { STAGE_LABELS } from "../domain/bookStages";
import { formatInr, isPayoutOverdueSuspected } from "./context";
import { ROYALTY_PAYOUT_THRESHOLD } from "../domain/royalties";

/**
 * Graceful degradation when the AI is disabled, rate-limited or down.
 * Tickets must still be created, queued and sorted sensibly, and admins
 * must still get a useful starting point for a reply. These rules are
 * intentionally simple and transparent: results are labelled RULES /
 * TEMPLATE in the UI so admins know to double-check them.
 */

/** [pattern, weight]: strong, unambiguous signals weigh 3; generic words weigh 1. */
const CATEGORY_KEYWORDS: Record<TicketCategory, [RegExp, number][]> = {
  ROYALTY_PAYMENTS: [[/royalt/i, 3], [/payout/i, 3], [/payment/i, 2], [/\bpaid\b/i, 1], [/bank/i, 1], [/earning/i, 1], [/commission/i, 1]],
  ISBN_METADATA: [[/\bisbn\b/i, 3], [/metadata/i, 3], [/imprint/i, 2], [/wrong (title|author name|price)/i, 2], [/description/i, 1]],
  PRINTING_QUALITY: [[/misprint/i, 3], [/blurr?y/i, 3], [/misalign/i, 3], [/binding/i, 3], [/defect/i, 2], [/print quality/i, 3], [/author cop(y|ies)/i, 1], [/print/i, 1]],
  DISTRIBUTION_AVAILABILITY: [[/unavailable/i, 3], [/out of stock/i, 3], [/not (available|listed|showing)/i, 2], [/listing/i, 1], [/amazon|flipkart/i, 1]],
  BOOK_STATUS_PRODUCTION: [[/typesett/i, 3], [/cover design/i, 3], [/proofread/i, 3], [/\bproofs?\b/i, 2], [/production/i, 2], [/delay/i, 1], [/when will/i, 1]],
  GENERAL_INQUIRY: [[/\bbio\b/i, 2], [/profile/i, 2], [/password|login|account/i, 1], [/package/i, 1]],
};

const CRITICAL_PATTERNS = [/\blegal\b/i, /lawyer/i, /consumer court/i, /fraud/i, /scam/i, /(six|6|seven|7|eight|8|nine|9|\d{2}) months/i, /wrong account/i];
const HIGH_PATTERNS = [/duplicate/i, /wrong (isbn|book)/i, /isbn.*(wrong|differ|mismatch|match)/i, /never (received|got|been paid)/i, /not (received|been paid)/i, /haven'?t (received|been paid)/i, /defect/i, /misprint/i, /blurr?y/i, /misalign/i, /unavailable/i, /out of stock/i, /urgent/i];
const LOW_PATTERNS = [/\bbio\b/i, /profile/i, /can i\b/i, /how (do|can) i/i, /is it possible/i, /just wondering/i];
const NON_RECEIPT = /(not|never|haven'?t|didn'?t) (yet )?(been )?(received|paid|got)/i;

export function classifyByRules(subject: string, description: string, book: Book | null, today: Date) {
  const text = `${subject}\n${description}`;

  let category: TicketCategory = "GENERAL_INQUIRY";
  let bestScore = 0;
  for (const [key, patterns] of Object.entries(CATEGORY_KEYWORDS) as [TicketCategory, [RegExp, number][]][]) {
    const score = patterns.reduce((sum, [pattern, weight]) => sum + (pattern.test(text) ? weight : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      category = key;
    }
  }
  // A question about a book that is still in production is almost always a status question.
  if (book && book.stage !== "PUBLISHED_LIVE" && category === "GENERAL_INQUIRY") category = "BOOK_STATUS_PRODUCTION";

  let priority: TicketPriority = "MEDIUM";
  if (CRITICAL_PATTERNS.some((p) => p.test(text))) priority = "CRITICAL";
  // Per BookLeaf policy, ISBN errors are always high priority.
  else if (HIGH_PATTERNS.some((p) => p.test(text)) || (category === "ISBN_METADATA" && /\bisbn\b/i.test(text))) priority = "HIGH";
  else if (LOW_PATTERNS.some((p) => p.test(text))) priority = "LOW";

  // Use account facts the way an ops person would.
  if (category === "ROYALTY_PAYMENTS" && book && priority !== "CRITICAL") {
    const belowThreshold = book.royaltyPending > 0 && book.royaltyPending < ROYALTY_PAYOUT_THRESHOLD;
    if (belowThreshold) priority = "MEDIUM"; // expected roll-over, not an error
    else if (NON_RECEIPT.test(text) && isPayoutOverdueSuspected(book, today)) priority = "HIGH";
  }

  return {
    category,
    priority,
    confidence: bestScore >= 3 ? 0.6 : bestScore > 0 ? 0.4 : 0.2,
    summary: subject.slice(0, 120),
  };
}

// ---------------------------------------------------------------------------
// Template drafts
// ---------------------------------------------------------------------------

function royaltyBody(book: Book | null): string {
  if (!book || book.stage !== "PUBLISHED_LIVE") {
    return `Royalties at BookLeaf are calculated quarterly and paid within 45 days of each quarter ending, by bank transfer to the account linked in your dashboard. Your share is 80% of the net profit per copy (MRP minus printing cost, platform commission and shipping). Balances below ${formatInr(ROYALTY_PAYOUT_THRESHOLD)} roll over to the next quarter.`;
  }
  const pendingLine =
    book.royaltyPending < ROYALTY_PAYOUT_THRESHOLD
      ? `Your pending balance of ${formatInr(book.royaltyPending)} is below our ${formatInr(ROYALTY_PAYOUT_THRESHOLD)} payout threshold, so it rolls over and will be paid once it crosses the threshold.`
      : `Your pending balance is ${formatInr(book.royaltyPending)}. [Confirm the payout date for this balance with finance.]`;
  return `For "${book.title}", our records show ${book.copiesSold} copies sold, ${formatInr(book.royaltyEarned)} earned in royalties, and ${formatInr(book.royaltyPaid)} paid out so far. ${pendingLine}\n\nRoyalties are calculated quarterly and paid within 45 days of each quarter ending. Your share is 80% of the net profit per copy (MRP minus printing cost, platform commission and shipping). I'm happy to share a detailed line-by-line breakdown.`;
}

const TEMPLATE_BODIES: Record<TicketCategory, (book: Book | null) => string> = {
  ROYALTY_PAYMENTS: royaltyBody,
  ISBN_METADATA: () =>
    `ISBN and metadata accuracy is critical, and I'm sorry for the trouble this has caused. I have escalated this to our production team as a high-priority issue, and we will get back to you with a resolution within 48 hours.`,
  PRINTING_QUALITY: () =>
    `I'm truly sorry the copies did not meet the standard you should expect from us. Could you please reply with a few photos of the defective pages or binding? Once verified, we will arrange a free reprint, which takes 5-7 business days.`,
  DISTRIBUTION_AVAILABILITY: () =>
    `When a published book shows as unavailable, it is usually a stock sync issue between our warehouse and the platform. I'm triggering a re-sync with our distribution team now, and the listing should be live again within 24-48 hours.`,
  BOOK_STATUS_PRODUCTION: (book) =>
    book && book.stage !== "PUBLISHED_LIVE"
      ? `"${book.title}" is currently in the ${STAGE_LABELS[book.stage]} stage. [Add the expected completion date for this stage.] We'll email you as it moves to each next stage.`
      : `[Add the current production stage and expected completion date.] We'll email you as your book moves through each stage.`,
  GENERAL_INQUIRY: () => `[Answer the author's question here.]`,
};

export function templateDraft(category: TicketCategory, authorName: string, book: Book | null): string {
  const firstName = authorName.split(" ")[0];
  return `Dear ${firstName},\n\nThank you for reaching out, and I understand why you'd want clarity on this.\n\n${TEMPLATE_BODIES[category](book)}\n\nPlease reply to this ticket if you have any other questions - we're here to help.\n\nWarm regards,\nBookLeaf Author Support`;
}
