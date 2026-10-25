/**
 * API integration tests against the seeded database (run `npm run db:seed`
 * first). They focus on the security-relevant contract: authentication,
 * role-based access, data isolation between authors, validation errors, and
 * graceful degradation of the AI endpoints.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { prisma } from "./lib/prisma";

// Env (and the AI being disabled) is set up in src/test/setup.ts.
const app = createApp();

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.token as string;
}

let adminToken: string;
let ananyaToken: string; // AUTH003
let rohitToken: string; // AUTH002
let ananyaTicketId: string;

beforeAll(async () => {
  [adminToken, ananyaToken, rohitToken] = await Promise.all([
    login("admin@bookleaf.com", "Admin@123"),
    login("ananya.reddy@email.com", "Author@123"),
    login("rohit.kapoor@email.com", "Author@123"),
  ]);
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { authorId: "AUTH003" } });
  ananyaTicketId = ticket.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("authentication", () => {
  it("rejects wrong credentials with a specific error code", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "admin@bookleaf.com", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("validates the login payload", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("protects every resource route", async () => {
    for (const path of ["/api/books", "/api/tickets", "/api/admin/stats", "/api/events"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe("role-based access", () => {
  it("authors only see their own books", async () => {
    const res = await request(app).get("/api/books").set(auth(ananyaToken));
    expect(res.status).toBe(200);
    expect(res.body.data.every((b: { authorId: string }) => b.authorId === "AUTH003")).toBe(true);
  });

  it("authors cannot read another author's book or ticket (404, not 403)", async () => {
    expect((await request(app).get("/api/books/BK005").set(auth(rohitToken))).status).toBe(404);
    expect((await request(app).get(`/api/tickets/${ananyaTicketId}`).set(auth(rohitToken))).status).toBe(404);
  });

  it("authors never receive internal triage data", async () => {
    const res = await request(app).get(`/api/tickets/${ananyaTicketId}`).set(auth(ananyaToken));
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("priority");
    expect(res.body.data).not.toHaveProperty("notes");
    expect(res.body.data).not.toHaveProperty("aiSummary");
  });

  it("authors cannot use admin endpoints", async () => {
    expect((await request(app).get("/api/admin/stats").set(auth(ananyaToken))).status).toBe(403);
    expect((await request(app).patch(`/api/tickets/${ananyaTicketId}`).set(auth(ananyaToken)).send({ status: "CLOSED" })).status).toBe(403);
    expect((await request(app).get(`/api/tickets/${ananyaTicketId}/draft`).set(auth(ananyaToken))).status).toBe(403);
  });

  it("admins cannot raise tickets as an author", async () => {
    const res = await request(app).post("/api/tickets").set(auth(adminToken)).send({ subject: "Hello there", description: "x".repeat(30) });
    expect(res.status).toBe(403);
  });

  it("admins see the full queue with triage fields", async () => {
    const res = await request(app).get("/api/tickets?status=OPEN,IN_PROGRESS").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(1);
    expect(res.body.data[0]).toHaveProperty("priority");
  });
});

describe("validation", () => {
  it("rejects a ticket for a book the author does not own", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set(auth(ananyaToken))
      .field("bookId", "BK001")
      .field("subject", "About someone else's book")
      .field("description", "This should not be allowed because BK001 is not mine.");
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("bookId");
  });

  it("rejects unknown filter values", async () => {
    const res = await request(app).get("/api/tickets?status=PENDING").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields on ticket updates", async () => {
    const res = await request(app).patch(`/api/tickets/${ananyaTicketId}`).set(auth(adminToken)).send({ authorId: "AUTH001" });
    expect(res.status).toBe(400);
  });
});

describe("AI graceful degradation", () => {
  it("serves a template draft when the AI is unavailable", async () => {
    const res = await request(app).get(`/api/tickets/${ananyaTicketId}/draft`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("TEMPLATE");
    expect(res.body.ai.available).toBe(false);
    expect(res.body.data.content).toContain("Dear Ananya");
  });
});
