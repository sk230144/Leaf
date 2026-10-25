import { Router } from "express";
import type { Book } from "@prisma/client";
import { z } from "zod";
import { notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { authenticate, currentUser } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { STAGE_LABELS, STAGE_ORDER } from "../../domain/bookStages";
import { ROYALTY_PAYOUT_THRESHOLD, upcomingRoyaltyPayout } from "../../domain/royalties";

export const booksRouter = Router();
booksRouter.use(authenticate);

function serializeBook(book: Book) {
  return {
    id: book.id,
    authorId: book.authorId,
    title: book.title,
    isbn: book.isbn,
    genre: book.genre,
    stage: book.stage,
    stageLabel: STAGE_LABELS[book.stage],
    stageIndex: STAGE_ORDER.indexOf(book.stage),
    isPublished: book.stage === "PUBLISHED_LIVE",
    publicationDate: book.publicationDate,
    mrp: book.mrp,
    royaltyPerCopy: book.royaltyPerCopy,
    copiesSold: book.copiesSold,
    royaltyEarned: book.royaltyEarned,
    royaltyPaid: book.royaltyPaid,
    royaltyPending: book.royaltyPending,
    lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate,
    printPartner: book.printPartner,
    availableOn: book.availableOn,
  };
}

const ListQuery = z.object({ authorId: z.string().optional() });

/**
 * GET /api/books
 * Authors: their own books. Admins: all books, optionally ?authorId=AUTH001.
 */
booksRouter.get("/", validate(ListQuery, "query"), async (req, res) => {
  const user = currentUser(req);
  const query = res.locals.query as z.infer<typeof ListQuery>;
  const authorId = user.role === "AUTHOR" ? user.authorId! : query.authorId;

  const books = await prisma.book.findMany({
    where: authorId ? { authorId } : undefined,
    orderBy: [{ publicationDate: { sort: "desc", nulls: "first" } }, { id: "asc" }],
  });

  const data = books.map(serializeBook);
  const totals = data.reduce(
    (acc, book) => ({
      copiesSold: acc.copiesSold + book.copiesSold,
      royaltyEarned: acc.royaltyEarned + book.royaltyEarned,
      royaltyPaid: acc.royaltyPaid + book.royaltyPaid,
      royaltyPending: acc.royaltyPending + book.royaltyPending,
    }),
    { copiesSold: 0, royaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0 },
  );
  const payout = upcomingRoyaltyPayout(new Date());
  res.json({
    data,
    totals,
    royaltySchedule: {
      nextPayoutQuarter: payout.quarterLabel,
      nextPayoutBy: payout.payoutDeadline,
      payoutThreshold: ROYALTY_PAYOUT_THRESHOLD,
    },
  });
});

/** GET /api/books/:id */
booksRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const book = await prisma.book.findUnique({ where: { id: req.params.id } });
  if (!book) throw notFound("Book");
  if (user.role === "AUTHOR" && book.authorId !== user.authorId) {
    // 404 rather than 403 so authors can't probe which book IDs exist.
    throw notFound("Book");
  }
  res.json({ data: serializeBook(book) });
});
