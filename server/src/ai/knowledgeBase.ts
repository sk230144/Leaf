import type { TicketCategory } from "@prisma/client";

/**
 * BookLeaf Knowledge Base, split into sections so each prompt only carries
 * what is relevant to the ticket's category (see `sectionsForCategory`).
 *
 * The text here is static on purpose: prompts built from it are
 * byte-identical between calls, which is what lets the API's prompt cache
 * serve them at ~10% of the normal input price.
 */
export const KB = {
  company: `## Company Overview
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Publishing packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution, and royalty management for authors.
- In-house printing facility and warehouse are in Delhi. Print partners include Repro India and Epitome Books.`,

  royalty: `## Royalty Policy
- 80/20 royalty split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. If accumulated royalties are below this, they roll over to the next quarter.
- Payouts are made via bank transfer to the account linked in the author's dashboard.
- Authors can view a detailed royalty breakdown in their dashboard, showing sales figures per platform.`,

  isbn: `## ISBN Policy
- Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.
- ISBNs are registered under BookLeaf's publisher imprint. If an author wants an ISBN under their own imprint, they need to obtain it independently.
- ISBN errors (duplicate ISBN, wrong book linked) are HIGH priority and are escalated to the production team, with a 48-hour resolution timeline.
- Metadata updates (e.g. book description) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3-5 business days.`,

  printing: `## Printing & Quality
- In-house printing handles most orders. Overflow or specific format requirements go to Repro India or Epitome Books.
- Standard print turnaround: 5-7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a FREE reprint after verification. The author may need to share photos of the defective copy. Reprint timeline: 5-7 business days once verified.`,

  distribution: `## Distribution & Availability
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.
- New listings typically go live within 7-10 business days after publication is complete.
- A book showing as unavailable ("Currently Unavailable") on a platform usually indicates a stock sync issue. BookLeaf's team can trigger a re-sync; it is live again within 24-48 hours.
- Metadata updates (e.g. book description) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3-5 business days.`,

  production: `## Production Stages
- Stages in order: Manuscript Received -> Editing (if opted) -> Cover Design -> Typesetting -> Proofreading -> ISBN Assignment -> Printing -> Distribution Setup -> Published & Live.
- Authors are updated at each stage via email.
- Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).
- Never blame the author for a delay, even if it is on their side - frame it collaboratively and give a specific updated timeline.`,

  tone: `## Communication Tone (BookLeaf house style)
- Always empathetic and professional. Authors are our partners, not customers to be managed.
- Acknowledge the author's concern before jumping to solutions.
- Be specific: include actual numbers, dates, and statuses wherever possible rather than vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue needs escalation or investigation, give a clear timeline ("Our team will look into this and get back to you within 48 hours"), never open-ended promises.
- Always end with a clear next step for the author and/or the BookLeaf team.`,
} as const;

/** Reference examples (query -> how BookLeaf frames the answer), per category. */
export const EXAMPLES: Record<TicketCategory, string> = {
  ROYALTY_PAYMENTS: `- Query: "I published my book 4 months ago and still haven't received any royalty."
  Approach: Acknowledge the frustration. Explain the quarterly cycle and 45-day payout window. Check bank details are linked. Give the specific next payout date. If genuinely overdue, own it and escalate with a 48-hour resolution timeline.
- Query: "My royalty seems too low. I sold 200 copies but only received ₹3,000."
  Approach: Explain net profit = MRP minus printing, platform commission and shipping, and the 80/20 split. Offer a line-by-line royalty breakdown. Not defensive - offer transparency.`,
  ISBN_METADATA: `- Query: "My book shows a different ISBN on Amazon than on the physical copy."
  Approach: Treat as high priority; acknowledge it is a serious data issue. Confirm it is being escalated to the production team immediately. Give a 48-hour resolution timeline.`,
  PRINTING_QUALITY: `- Query: "My author copies have blurry images and misaligned pages."
  Approach: Apologise sincerely. Ask for photos of the defective copies. Confirm a free reprint once verified, with a 5-7 business day timeline.`,
  DISTRIBUTION_AVAILABILITY: `- Query: "My book is published but shows 'Currently Unavailable' on Amazon."
  Approach: Explain it is typically a stock sync issue. Confirm a re-sync is being triggered with the distribution team. Set expectation: live again within 24-48 hours.`,
  BOOK_STATUS_PRODUCTION: `- Query: "It's been 3 weeks and my book is still in typesetting. When will it be done?"
  Approach: State the actual production status. If delayed, be honest about why (e.g. waiting on proof approval) without blaming the author - frame it collaboratively. Give a specific updated timeline.`,
  GENERAL_INQUIRY: `- Query: "Can I update the description of my book on Amazon after it's live?"
  Approach: Yes - submit via the dashboard or email the BookLeaf team; changes typically reflect within 3-5 business days.`,
};

type SectionKey = keyof typeof KB;

const CATEGORY_SECTIONS: Record<TicketCategory, SectionKey[]> = {
  ROYALTY_PAYMENTS: ["royalty"],
  ISBN_METADATA: ["isbn", "distribution"],
  PRINTING_QUALITY: ["printing"],
  DISTRIBUTION_AVAILABILITY: ["distribution"],
  BOOK_STATUS_PRODUCTION: ["production", "distribution"],
  // General questions can touch anything, so they get every policy section.
  GENERAL_INQUIRY: ["royalty", "isbn", "printing", "distribution", "production"],
};

/** Policy sections relevant to a category (company + tone are always included separately). */
export function sectionsForCategory(category: TicketCategory): string {
  return CATEGORY_SECTIONS[category].map((key) => KB[key]).join("\n\n");
}

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  ROYALTY_PAYMENTS: "Royalty & Payments",
  ISBN_METADATA: "ISBN & Metadata Issues",
  PRINTING_QUALITY: "Printing & Quality",
  DISTRIBUTION_AVAILABILITY: "Distribution & Availability",
  BOOK_STATUS_PRODUCTION: "Book Status & Production Updates",
  GENERAL_INQUIRY: "General Inquiry",
};
