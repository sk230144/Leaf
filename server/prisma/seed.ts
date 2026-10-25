/**
 * Seeds the database from the provided bookleaf_sample_data.json (10 authors,
 * 18 books - used verbatim) plus two admin users and a handful of realistic
 * sample tickets so the queue isn't empty on first login.
 *
 * Sample tickets are inserted UNCLASSIFIED (aiStatus = PENDING): on server
 * start they are picked up by the classification queue exactly like a newly
 * submitted ticket, which demonstrates the real pipeline.
 *
 *   npm run db:seed            -> wipe and re-seed
 *   node dist/prisma/seed.js --if-empty   -> seed only a fresh database (deploys)
 */
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import type { BookStage } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const DEMO_PASSWORDS = { admin: "Admin@123", author: "Author@123" };

interface SourceBook {
  book_id: string;
  title: string;
  isbn: string;
  genre: string;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}

interface SourceAuthor {
  author_id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  joined_date: string;
  books: SourceBook[];
}

const STAGE_BY_LABEL: Record<string, BookStage> = {
  "manuscript received": "MANUSCRIPT_RECEIVED",
  editing: "EDITING",
  "cover design": "COVER_DESIGN",
  typesetting: "TYPESETTING",
  proofreading: "PROOFREADING",
  "isbn assignment": "ISBN_ASSIGNMENT",
  printing: "PRINTING",
  "distribution setup": "DISTRIBUTION_SETUP",
  "published & live": "PUBLISHED_LIVE",
};

/** "In Production - Cover Design" -> COVER_DESIGN, "Published & Live" -> PUBLISHED_LIVE */
function toStage(status: string): BookStage {
  const label = status.replace(/^in production\s*-\s*/i, "").trim().toLowerCase();
  const stage = STAGE_BY_LABEL[label];
  if (!stage) throw new Error(`Unknown book status in seed data: "${status}"`);
  return stage;
}

const date = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

function findDataFile(): string {
  const candidates = [
    path.resolve(process.cwd(), "prisma/data/bookleaf_sample_data.json"),
    path.resolve(__dirname, "data/bookleaf_sample_data.json"),
    path.resolve(__dirname, "../../prisma/data/bookleaf_sample_data.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("bookleaf_sample_data.json not found");
  return found;
}

async function main() {
  if (process.argv.includes("--if-empty") && (await prisma.user.count()) > 0) {
    console.log("Database already seeded - skipping.");
    return;
  }

  const { authors } = JSON.parse(fs.readFileSync(findDataFile(), "utf8")) as { authors: SourceAuthor[] };

  // Wipe in dependency order (cascades handle tickets' children).
  await prisma.aiUsageLog.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.book.deleteMany();
  await prisma.author.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRaw`ALTER SEQUENCE "Ticket_number_seq" RESTART WITH 1001`;

  const [adminHash, authorHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORDS.admin, 10),
    bcrypt.hash(DEMO_PASSWORDS.author, 10),
  ]);

  const anjali = await prisma.user.create({
    data: { email: "admin@bookleaf.com", name: "Anjali Mehta", role: "ADMIN", passwordHash: adminHash },
  });
  await prisma.user.create({
    data: { email: "support@bookleaf.com", name: "Karan Verma", role: "ADMIN", passwordHash: adminHash },
  });

  for (const author of authors) {
    await prisma.user.create({
      data: {
        email: author.email.toLowerCase(),
        name: author.name,
        role: "AUTHOR",
        passwordHash: authorHash,
        author: {
          create: {
            id: author.author_id,
            phone: author.phone,
            city: author.city,
            joinedDate: date(author.joined_date)!,
            books: {
              create: author.books.map((book) => ({
                id: book.book_id,
                title: book.title,
                isbn: book.isbn,
                genre: book.genre,
                stage: toStage(book.status),
                publicationDate: date(book.publication_date),
                mrp: book.mrp,
                royaltyPerCopy: book.author_royalty_per_copy,
                copiesSold: book.total_copies_sold,
                royaltyEarned: book.total_royalty_earned,
                royaltyPaid: book.royalty_paid,
                royaltyPending: book.royalty_pending,
                lastRoyaltyPayoutDate: date(book.last_royalty_payout_date),
                printPartner: book.print_partner,
                availableOn: book.available_on,
              })),
            },
          },
        },
      },
    });
  }

  await seedSampleTickets(anjali.id);

  const counts = await Promise.all([prisma.author.count(), prisma.book.count(), prisma.ticket.count()]);
  console.log(`Seeded ${counts[0]} authors, ${counts[1]} books, ${counts[2]} sample tickets, 2 admins.`);
}

async function seedSampleTickets(adminId: string) {
  const userIdFor = async (authorId: string) =>
    (await prisma.author.findUniqueOrThrow({ where: { id: authorId }, select: { userId: true } })).userId;

  const samples: {
    authorId: string;
    bookId: string | null;
    subject: string;
    description: string;
    ageHours: number;
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED";
    reply?: string;
    note?: string;
    assign?: boolean;
  }[] = [
    {
      authorId: "AUTH003",
      bookId: "BK005",
      subject: "Haven't received any royalty since my book was published",
      description:
        "Hi, my book Between Two Temples was published in July 2024 and I have still not received a single rupee in royalty. My dashboard shows ₹2,546 pending. Other authors I know get paid every quarter. What is going on? This is really disappointing.",
      ageHours: 70,
    },
    {
      authorId: "AUTH002",
      bookId: "BK004",
      subject: "Different ISBN on Amazon vs my printed copy",
      description:
        "The ISBN printed on the back of my author copies of Startup Sutra does not match the ISBN shown on the Amazon India listing. I'm worried readers are being sent to the wrong book or that my sales are being counted against another title. Please fix this urgently.",
      ageHours: 6,
    },
    {
      authorId: "AUTH007",
      bookId: "BK013",
      subject: "When will the cover for Midnight in Mysore be ready?",
      description:
        "It's been almost three weeks and my thriller is still showing 'Cover Design' in the dashboard. I'd like to plan a launch for next month - could you tell me when the cover will be finalised and what the next steps are?",
      ageHours: 26,
    },
    {
      authorId: "AUTH005",
      bookId: "BK009",
      subject: "Letters from Lakshadweep shows Currently Unavailable on Amazon US",
      description:
        "A reader in the US told me my book shows as 'Currently Unavailable' on Amazon US. It was fine last month. Can you check?",
      ageHours: 50,
      status: "IN_PROGRESS",
      assign: true,
      reply:
        "Dear Meera,\n\nThank you for flagging this - I know how frustrating it is to hear a reader couldn't buy your book.\n\nThis is almost always a stock sync issue between our warehouse and Amazon US. I've asked our distribution team to trigger a re-sync, and the listing should be live again within 24-48 hours. I'll confirm here once it is.\n\nWarm regards,\nBookLeaf Author Support",
      note: "Re-sync requested with distribution team. Check Amazon US listing tomorrow.",
    },
    {
      authorId: "AUTH004",
      bookId: null,
      subject: "Can I update my author bio?",
      description:
        "Hello, I'd like to update my author bio that appears on my book pages - I have a new book coming out and want to mention it. How can I do this?",
      ageHours: 100,
      status: "RESOLVED",
      reply:
        "Dear Vikram,\n\nCongratulations on the new book! You can submit an updated bio through your dashboard (Profile > Author Bio) or simply reply here with the new text. Changes typically reflect on the platforms within 3-5 business days.\n\nWarm regards,\nBookLeaf Author Support",
    },
    {
      authorId: "AUTH009",
      bookId: "BK016",
      subject: "No royalty received for The Nagpur Notebooks",
      description:
        "My book The Nagpur Notebooks has sold 34 copies but I have not received any royalty payment yet. Could you please check if something is wrong with my account?",
      ageHours: 12,
    },
    {
      authorId: "AUTH008",
      bookId: "BK014",
      subject: "Author copies have blurry text and misaligned pages",
      description:
        "I received my author copies of Ghazal of the Forgotten yesterday. The Urdu calligraphy on several pages is blurry and pages 40-56 are misaligned. I was planning to gift these at a mushaira next week. Very upset with the print quality.",
      ageHours: 20,
    },
    {
      authorId: "AUTH001",
      bookId: "BK001",
      subject: "Royalty amount seems too low for the copies sold",
      description:
        "Whispers of the Ganges has sold 342 copies at ₹399 but my total royalty is only ₹11,970. That's about ₹35 per copy, which seems very low. Could you explain how this is calculated?",
      ageHours: 120,
    },
  ];

  for (const sample of samples) {
    const createdAt = hoursAgo(sample.ageHours);
    const ticket = await prisma.ticket.create({
      data: {
        authorId: sample.authorId,
        bookId: sample.bookId,
        subject: sample.subject,
        description: sample.description,
        status: sample.status ?? "OPEN",
        assigneeId: sample.assign ? adminId : null,
        createdAt,
        events: { create: { type: "CREATED", actorId: await userIdFor(sample.authorId), createdAt } },
      },
    });
    if (sample.reply) {
      const repliedAt = new Date(createdAt.getTime() + 3 * 60 * 60 * 1000);
      await prisma.ticketMessage.create({
        data: { ticketId: ticket.id, senderId: adminId, senderRole: "ADMIN", body: sample.reply, createdAt: repliedAt },
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          firstResponseAt: repliedAt,
          resolvedAt: sample.status === "RESOLVED" ? repliedAt : null,
        },
      });
    }
    if (sample.note) {
      await prisma.internalNote.create({ data: { ticketId: ticket.id, adminId, body: sample.note } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
