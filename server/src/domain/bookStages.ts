import type { BookStage } from "@prisma/client";

/** BookLeaf production pipeline, in order (from the knowledge base). */
export const STAGE_ORDER: BookStage[] = [
  "MANUSCRIPT_RECEIVED",
  "EDITING",
  "COVER_DESIGN",
  "TYPESETTING",
  "PROOFREADING",
  "ISBN_ASSIGNMENT",
  "PRINTING",
  "DISTRIBUTION_SETUP",
  "PUBLISHED_LIVE",
];

export const STAGE_LABELS: Record<BookStage, string> = {
  MANUSCRIPT_RECEIVED: "Manuscript Received",
  EDITING: "Editing",
  COVER_DESIGN: "Cover Design",
  TYPESETTING: "Typesetting",
  PROOFREADING: "Proofreading",
  ISBN_ASSIGNMENT: "ISBN Assignment",
  PRINTING: "Printing",
  DISTRIBUTION_SETUP: "Distribution Setup",
  PUBLISHED_LIVE: "Published & Live",
};
