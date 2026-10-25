import type { TicketCategory, TicketPriority, TicketStatus } from "../api/types";

export const CATEGORY_OPTIONS: { value: TicketCategory; label: string }[] = [
  { value: "ROYALTY_PAYMENTS", label: "Royalty & Payments" },
  { value: "ISBN_METADATA", label: "ISBN & Metadata Issues" },
  { value: "PRINTING_QUALITY", label: "Printing & Quality" },
  { value: "DISTRIBUTION_AVAILABILITY", label: "Distribution & Availability" },
  { value: "BOOK_STATUS_PRODUCTION", label: "Book Status & Production Updates" },
  { value: "GENERAL_INQUIRY", label: "General Inquiry" },
];

export const PRIORITY_OPTIONS: TicketPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];
