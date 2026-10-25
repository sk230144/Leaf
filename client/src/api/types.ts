export type Role = "AUTHOR" | "ADMIN";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TicketPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type TicketCategory =
  | "ROYALTY_PAYMENTS"
  | "ISBN_METADATA"
  | "PRINTING_QUALITY"
  | "DISTRIBUTION_AVAILABILITY"
  | "BOOK_STATUS_PRODUCTION"
  | "GENERAL_INQUIRY";
export type ClassificationSource = "AI" | "RULES" | "ADMIN";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  authorId: string | null;
}

export interface Book {
  id: string;
  authorId: string;
  title: string;
  isbn: string;
  genre: string;
  stage: string;
  stageLabel: string;
  stageIndex: number;
  isPublished: boolean;
  publicationDate: string | null;
  mrp: number | null;
  royaltyPerCopy: number | null;
  copiesSold: number;
  royaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface BookTotals {
  copiesSold: number;
  royaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
}

export interface RoyaltySchedule {
  nextPayoutQuarter: string;
  nextPayoutBy: string;
  payoutThreshold: number;
}

export interface Message {
  id: string;
  body: string;
  senderRole: Role;
  senderName: string;
  createdAt: string;
  fromAiDraft?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

interface TicketBase {
  id: string;
  number: number;
  reference: string;
  subject: string;
  status: TicketStatus;
  book: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  awaitingSupport: boolean;
}

interface Triage {
  category: TicketCategory | null;
  categoryLabel: string | null;
  categorySource: ClassificationSource | null;
  priority: TicketPriority | null;
  prioritySource: ClassificationSource | null;
  aiStatus: "PENDING" | "COMPLETED" | "FAILED";
  aiConfidence: number | null;
  aiSummary: string | null;
  aiError: string | null;
  assignee: { id: string; name: string } | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
}

export interface TicketSummary extends TicketBase {
  messageCount: number;
  hasAttachment: boolean;
}

export interface AdminTicketSummary extends TicketSummary, Triage {
  author: { id: string; name: string };
}

export interface TicketDetail extends TicketBase {
  description: string;
  attachments: Attachment[];
  messages: Message[];
}

export interface AdminTicketDetail extends TicketDetail, Triage {
  author: { id: string; name: string; email: string; phone: string | null; city: string | null; joinedDate: string };
  bookDetails: (Omit<Book, "authorId" | "genre" | "stageIndex" | "isPublished" | "royaltyPerCopy">) | null;
  notes: { id: string; body: string; adminName: string; createdAt: string }[];
  events: { id: string; type: string; fromValue: string | null; toValue: string | null; actorName: string | null; createdAt: string }[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AiStatus {
  enabled: boolean;
  available: boolean;
  provider: "gemini" | "anthropic";
  model: string;
  retryAt: string | null;
}

export interface Draft {
  id: string;
  source: "AI" | "TEMPLATE";
  content: string;
  suggestedStatus: TicketStatus | null;
  needsEscalation: boolean;
  escalationNote: string | null;
  missingInfo: string[];
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftResponse {
  data: Draft;
  fallbackReason: string | null;
  ai: AiStatus;
}

export interface AdminStats {
  tickets: {
    byStatus: Partial<Record<TicketStatus, number>>;
    activeByPriority: Partial<Record<TicketPriority | "UNCLASSIFIED", number>>;
    unassignedActive: number;
    awaitingFirstResponse: number;
    oldestActiveCreatedAt: string | null;
  };
  ai: AiStatus & {
    last30Days: {
      calls: number;
      failures: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      cacheHitRate: number;
      estimatedCostUsd: number;
    };
    quality: { aiClassifications: number; categoryOverrides: number; draftAdoptionRate: number | null };
  };
}
