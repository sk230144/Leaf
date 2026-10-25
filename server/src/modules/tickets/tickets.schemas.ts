import { z } from "zod";

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export const TICKET_CATEGORIES = [
  "ROYALTY_PAYMENTS",
  "ISBN_METADATA",
  "PRINTING_QUALITY",
  "DISTRIBUTION_AVAILABILITY",
  "BOOK_STATUS_PRODUCTION",
  "GENERAL_INQUIRY",
] as const;
export const TICKET_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** Accepts `?status=OPEN,IN_PROGRESS` as well as a single value. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

export const ListTicketsQuery = z.object({
  status: csvEnum(TICKET_STATUSES).optional(),
  category: csvEnum(TICKET_CATEGORIES).optional(),
  priority: csvEnum(TICKET_PRIORITIES).optional(),
  /** "me", "unassigned", or an admin user id */
  assignee: z.string().optional(),
  authorId: z.string().optional(),
  bookId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  /** urgency = priority (critical first) then oldest first */
  sort: z.enum(["urgency", "oldest", "newest", "updated"]).default("urgency"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListTicketsQuery = z.infer<typeof ListTicketsQuery>;

/**
 * Ticket creation arrives as multipart/form-data (because of the optional
 * attachment), so every field is a string; "general" or empty = no book.
 */
export const CreateTicketBody = z.object({
  bookId: z
    .string()
    .optional()
    .transform((value) => (!value || value === "general" ? null : value)),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(150, "Subject must be at most 150 characters"),
  description: z
    .string()
    .trim()
    .min(20, "Please describe the issue in at least 20 characters")
    .max(5000, "Description must be at most 5000 characters"),
});
export type CreateTicketBody = z.infer<typeof CreateTicketBody>;

export const UpdateTicketBody = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    /** Admin user id, or null to unassign */
    assigneeId: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update" });
export type UpdateTicketBody = z.infer<typeof UpdateTicketBody>;

export const CreateMessageBody = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000, "Message must be at most 5000 characters"),
  /** Admin only: set the ticket status in the same action as replying */
  status: z.enum(TICKET_STATUSES).optional(),
  /** Admin only: whether the reply started from the AI draft (adoption metric) */
  fromAiDraft: z.boolean().optional(),
});
export type CreateMessageBody = z.infer<typeof CreateMessageBody>;

export const CreateNoteBody = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(5000, "Note must be at most 5000 characters"),
});
export type CreateNoteBody = z.infer<typeof CreateNoteBody>;
