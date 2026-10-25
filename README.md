# BookLeaf Author Support & Communication Portal

A full-stack support desk for BookLeaf Publishing. Authors check their books and royalties and raise support tickets. The operations team works a prioritised queue in which every ticket is classified automatically and comes with a draft reply grounded in the BookLeaf knowledge base.

| | |
|---|---|
| **Live demo** | _add deployed URL here_ |
| **API docs** | `/api/docs` (Swagger UI) · raw spec: [`server/openapi.yaml`](server/openapi.yaml) |
| **Write-up** | [`WRITEUP.md`](WRITEUP.md) |

### Test credentials

| Role | Email | Password |
|---|---|---|
| Admin (ops) | `admin@bookleaf.com` | `Admin@123` |
| Admin (second, for assignment) | `support@bookleaf.com` | `Admin@123` |
| Author | any of the 10 emails in `bookleaf_sample_data.json`, e.g. `ananya.reddy@email.com` | `Author@123` |

Useful author accounts for edge cases:
- `ananya.reddy@email.com`: never paid out, with ₹2,546 pending.
- `kavita.deshmukh@email.com`: one book in production, and ₹850 pending, which is below the ₹1,000 payout threshold.
- `sneha.kulkarni@email.com`: one book in Cover Design.
- `arjun.malhotra@email.com`: no tickets yet (empty state).

The login page has one-click buttons that fill in these accounts.

---

## Contents

1. [Running locally](#1-running-locally)
2. [Architecture](#2-architecture)
3. [AI integration](#3-ai-integration)
4. [API](#4-api)
5. [Testing](#5-testing)
6. [Deployment](#6-deployment)
7. [Known limitations & next steps](#7-known-limitations--next-steps)

---

## 1. Running locally

**Prerequisites:** Node 20+ and Docker (for PostgreSQL). An Anthropic API key is optional. Without one, the app runs in degraded mode: rule-based triage and template drafts.

```bash
npm install                       # installs both workspaces
npm run db:up                     # starts Postgres 16 in Docker (localhost:5432)
cp server/.env.example server/.env
#   then set JWT_SECRET, and ANTHROPIC_API_KEY if you have one
npm run db:setup                  # applies migrations + seeds the provided dataset
npm run dev                       # API on :4000, web app on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`) + Vite dev server. Vite proxies `/api` so the browser sees one origin. |
| `npm test` | Server test suite: 37 tests covering unit, API integration and SDK integration. Needs the seeded DB. |
| `npm run typecheck` | Strict TypeScript across both apps. |
| `npm run build` | Production build of both apps. |
| `npm run db:seed -w server` | Wipe and re-seed the database. |

The seed loads the provided JSON verbatim: 10 authors and 18 books. It also adds 2 admins and 8 realistic sample tickets. The sample tickets are inserted **unclassified**. On startup the server re-queues them, so they go through the real classification pipeline, just like new tickets.

---

## 2. Architecture

```
┌──────────────── Browser ────────────────┐        ┌──────────────────── Node / Express ─────────────────────┐
│ React + TanStack Query                  │  REST  │ middleware: helmet · auth (JWT cookie/Bearer) · RBAC ·   │
│  Author portal  │  Admin portal         │◄──────►│            zod validation · error envelope               │
│                 │                       │        │ modules/   auth · books · tickets · admin                │
│ EventSource ◄───┼── SSE /api/events ────┼────────│ realtime/  event bus ─► SSE fan-out (role-filtered)      │
└─────────────────────────────────────────┘        │ ai/        classifier · drafter · prompts · KB ·         │
                                                   │            llm (SDK wrapper, breaker, usage log) ·       │
                                                   │            fallback (rules + templates) · job queue      │
                                                   │ domain/    royalty rules · production stages             │
                                                   └──────────────┬───────────────────────┬───────────────────┘
                                                                  │ Prisma                │ HTTPS (server-side key)
                                                            PostgreSQL               Anthropic API
```

### Stack and why

| Layer | Choice | Reasoning |
|---|---|---|
| Backend | **Express 5 + TypeScript** | Small, well understood, async errors propagate natively in v5. Feature modules (`routes → service → serializer`) keep HTTP, business logic and output shaping apart. |
| Database | **PostgreSQL + Prisma** | Relational data with real relations (authors → books → tickets → messages). Prisma gives typed queries and versioned migrations. Postgres enum ordering is used for the urgency sort. |
| Validation | **zod** | One schema validates the request, produces the TypeScript type, and returns per-field error messages. The same library defines the AI output schemas. |
| Frontend | **React + Vite + TanStack Query + Tailwind** | Query caching plus invalidation makes real-time updates trivial: an SSE event just invalidates the affected queries. |
| Real-time | **Server-Sent Events** | Updates only flow server → client. SSE is plain HTTP, reconnects automatically and passes through proxies. WebSockets would add a protocol and a library for no benefit here. |
| Auth | **JWT in an httpOnly cookie** (Bearer also accepted) | Not readable by JS, so it is XSS-resistant. It also lets `EventSource`, which can't set headers, authenticate. The token is also returned for Postman/curl. |

### Project layout

```
server/
  prisma/            schema.prisma, migrations, seed.ts, data/bookleaf_sample_data.json
  openapi.yaml       API spec (served at /api/docs)
  src/
    ai/              everything LLM-related (see §3)
    domain/          business rules shared by API + AI (royalty schedule, production stages)
    modules/         auth, books, tickets (routes/service/schemas/serializer), admin
    realtime/        event bus + SSE endpoint
    middleware/      auth/RBAC, validation, uploads, error handler
client/src/
  api/               fetch wrapper, types, query/mutation hooks
  pages/author/      My Books, Submit Query, My Tickets, ticket thread
  pages/admin/       Queue, ticket workspace (reply composer, sidebar, notes)
```

### Data model highlights

- **`User` ↔ `Author`.** Identity is separated from the author profile. Business IDs from the dataset (`AUTH001`, `BK001`) are kept as primary keys, so the data matches what BookLeaf uses.
- **`Book.stage`** is an enum of the 9 production stages from the knowledge base, rather than a free-text status. The UI renders a progress tracker from it, and the AI can say exactly which stages remain.
- **`Ticket`** stores `category`/`priority` together with their **source** (`AI`, `RULES` or `ADMIN`). Automated classification never overwrites an admin override.
- **`TicketMessage`** (public thread) and **`InternalNote`** (admin-only) are separate tables, so a serializer bug can't leak notes to authors.
- **`TicketEvent`** is an audit log of status changes, overrides, assignments and classifications. Override events double as a measure of classifier accuracy.
- **`AiDraft`** holds one cached draft per ticket, keyed to the thread length so it's regenerated only when the conversation changes.
- **`AiUsageLog`** holds one row per LLM call: tokens (including cache reads and writes), latency, success and error type. It feeds the cost panel in the admin dashboard.

### Security and access control

- Every route except login, logout and health requires authentication. `requireRole` guards admin endpoints.
- Authors are scoped to their own `authorId` in every query. Another author's ticket or book returns **404, not 403**, so IDs can't be probed.
- Role-aware serializers mean authors never receive priority, AI fields, notes, assignee or the audit log. This is covered by tests.
- Other measures:
  - The login endpoint is rate-limited.
  - Passwords are hashed with bcrypt.
  - helmet headers are set.
  - Uploads are type- and size-checked (PNG/JPG/WEBP/PDF, 5 MB) and stored under random names. Attachment downloads go through the same access check as the ticket.

### Product decisions

- **Queue order** puts the highest priority first, then the oldest. Tickets still being classified appear at the very top. Rows waiting on BookLeaf for more than 24 hours get a red ⚠. Critical rows are tinted.
- **Status flow:**
  - An admin reply moves an `OPEN` ticket to `IN_PROGRESS`.
  - A reply can also set the status in the same action ("Send & resolve").
  - An author follow-up on a `RESOLVED` ticket reopens it.
  - `CLOSED` tickets ask the author to open a new one.
- **Authors see their numbers in context.** "Next payout: Jul–Sep 2026, by 14 Nov 2026" is shown with the pending balance, along with an explanation when a balance is below the ₹1,000 threshold. Books in production show the stage tracker instead of zeros. This answers the most common question before it becomes a ticket.
- **Filters live in the URL**, so a filtered queue view can be shared.

---

## 3. AI integration

### Model choice: Claude Haiku 5.5 (`claude-haiku-5-5`)

Both AI tasks are short and tightly specified: pick from fixed labels, or draft roughly 200 words grounded in supplied facts. They are also high-volume, and the draft must be ready in about the time it takes an admin to open the ticket. Haiku 5.5 suits this:

- It costs $0.10 / $0.50 per million input/output tokens, with cache reads at $0.01.
- It supports schema-constrained structured outputs and prompt caching.
- It is fast enough to draft a reply while the page loads.

The model is set by `AI_MODEL`, so moving the drafting step to a larger model, if quality review shows a need, is a config change.

### What the AI does

| Step | When | Input | Output |
|---|---|---|---|
| **Classify + prioritise** (one call) | Background job right after ticket creation | Subject, description (clipped to 4,000 chars), a one-line account summary (e.g. "royalty paid ₹0, pending ₹2,546, last payout never, payout possibly overdue") | `{ category, priority, confidence, summary }` |
| **Draft reply** | When an admin opens the ticket | Category-scoped KB, facts about the referenced book, payout schedule, last 6 messages of the thread | `{ reply, suggested_status, needs_escalation, escalation_note, missing_info[] }` |

Both calls use **structured outputs** (`output_config.format` generated from zod schemas and validated by the SDK's `messages.parse`). There is no regex JSON parsing. Output that doesn't match the schema is rejected and handled like any other AI failure.

### Prompt strategy

Prompts are in [`server/src/ai/prompts.ts`](server/src/ai/prompts.ts); the knowledge base is in [`knowledgeBase.ts`](server/src/ai/knowledgeBase.ts).

1. **Knowledge base as the source of truth.** The draft prompt tells the model to ground every policy statement in the KB, and never to invent fees, timelines or compensation. The tone guidelines are included verbatim, along with that category's reference examples from the brief.
2. **Facts are computed in code, not by the model.** [`domain/royalties.ts`](server/src/domain/royalties.ts) works out the next quarterly payout deadline, whether a balance is below the ₹1,000 threshold, and whether a payout looks overdue. The model then quotes "will be paid by 14 Nov 2026" rather than doing date math. This is how the drafts meet the tone guide's "include actual numbers and dates" requirement.
3. **Honest placeholders instead of hallucinations.** The model can't see bank details, order numbers or investigation results. Where one is needed, it writes a `[bracketed placeholder]` and lists it in `missing_info`. The admin UI shows a "Verify before sending" checklist and warns if a placeholder is still in the text when Send is pressed.
4. **"Own it" is driven by data.** When the facts flag a possibly overdue payout, the prompt tells the model to own the problem, escalate to finance and give a 48-hour timeline, as the KB requires. When the balance is under the threshold, it explains the roll-over instead.
5. **Escalation is structured.** `needs_escalation` and `escalation_note` appear as an "Escalation suggested" banner with one-click "Save as internal note".
6. **Prompt-injection hygiene.** Author text only ever goes in the user turn, inside `<ticket>` / `<ticket_thread>` tags. The system prompt states that it is untrusted data. Category and priority are constrained to enums, so a ticket can't classify itself as anything outside the schema.
7. **Priority uses context, not tone.** The rubric explicitly tells the model to judge impact, not tone. An angry bio-update request is LOW; a polite duplicate-ISBN report is HIGH, matching the KB rule that ISBN errors are high priority.

### Cost management

Approximate per-call token counts (characters ÷ 4) with Haiku 5.5 pricing:

| Lever | Effect |
|---|---|
| **One call for category + priority** | Half the calls a naive design would make. |
| **Only the relevant KB is sent.** Each category maps to its policy sections. | Royalty drafts carry about 1,000 system tokens and printing drafts about 870, versus about 1,400 for the full KB plus examples. |
| **Prompt caching.** System prompts are fully static, with cache breakpoints after the shared segment (role, rules, company, tone: about 690 tokens) and after the category segment. | At most 7 distinct prefixes exist (1 classifier + 6 draft categories). After the first call each is a cache read at 10% of the input price. A unit test asserts the system prompts stay byte-identical across tickets, because a timestamp in a system prompt would silently break caching. |
| **Drafts are cached in the DB** and regenerated only when the thread changes or the admin clicks Regenerate. Concurrent opens share one in-flight call. | Re-opening a ticket or a second admin viewing it costs nothing. |
| **Bounded context.** Only the ticket's own book (or the author's books for account-level tickets) is sent, plus the original query and the last 6 messages, each clipped. Never the full history or other tickets. | Prompt size stays flat as threads grow. |
| **Effort tuned per task.** `low` for classification, `medium` for drafting. | Less thinking-token spend on the simple task. |
| **Usage logged per call.** The admin dashboard shows 30-day calls, estimated cost and cache-hit rate. | Spend is visible, not guessed. |

Rough estimate: about $0.0001 per classification and $0.0003 per draft, so under $5 for 10,000 tickets a month. Thinking tokens and long threads raise this. The `AiUsageLog` table gives the real figure once live traffic flows.

### Error handling and graceful degradation

All AI calls go through [`ai/llm.ts`](server/src/ai/llm.ts). It maps the SDK's typed errors (`RateLimitError`, `APIConnectionError`, `InternalServerError`, `AuthenticationError`, and so on) to a small set of failure kinds and throws a single `AiUnavailableError`, so each feature has exactly one thing to catch.

| Situation | What happens |
|---|---|
| Transient 429 / 5xx / network blip | The SDK retries twice with backoff; the timeout is 20 s. |
| Repeated failures (3 in a row) | The **circuit breaker** opens for 60 s (10 min for a bad key). Calls fail fast instead of piling up. The dashboard shows "AI: Paused". |
| AI down when a ticket is created | The ticket is created instantly regardless, since classification runs in the background. **Keyword rules** classify it, marked `RULES` in the UI, so the queue still sorts sensibly. An admin can click "Retry with AI" later. |
| AI down when an admin opens a ticket | A **category template draft** is loaded, using the author's real numbers. A banner explains why, and the admin edits and sends it normally. Once the AI is back, the template is upgraded to an AI draft on next open. |
| Model output fails schema validation or is refused | Treated as a per-request failure (falls back, doesn't trip the breaker). |
| No `ANTHROPIC_API_KEY` | The app runs fully on rules and templates. This mode is what the test suite exercises. |
| Server restarts mid-classification | Tickets left `PENDING` are re-queued on boot. |

**Key security:** `ANTHROPIC_API_KEY` is read only in `server/src/config/env.ts` and used only in `ai/llm.ts`. It is never sent to the client, and the browser never talks to Anthropic.

---

## 4. API

Full interactive documentation is at **`/api/docs`** (OpenAPI 3, [`server/openapi.yaml`](server/openapi.yaml)). Summary:

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Sign in (sets cookie, returns JWT) |
| POST | `/api/auth/logout` | public | Clear session |
| GET | `/api/auth/me` | any | Current user |
| GET | `/api/books` | any | Own books (author) / all books (admin), with totals and payout schedule |
| GET | `/api/books/:id` | any | One book (authors: own only) |
| GET | `/api/tickets` | any | Authors: own tickets. Admins: queue with `status, category, priority, assignee, authorId, bookId, from, to, q, sort, page, pageSize` |
| POST | `/api/tickets` | author | Create ticket (multipart, optional attachment) → `201` |
| GET | `/api/tickets/:id` | any | Detail + thread (admins also get triage, notes, audit log, context) |
| PATCH | `/api/tickets/:id` | admin | Status, category/priority override, assignment |
| POST | `/api/tickets/:id/messages` | any | Public reply (author follow-up or admin response, optional status change) |
| POST | `/api/tickets/:id/notes` | admin | Internal note |
| GET | `/api/tickets/:id/attachments/:attachmentId` | any | Download attachment (ticket access rules) |
| GET | `/api/tickets/:id/draft` | admin | Cached AI draft (generated on first request) |
| POST | `/api/tickets/:id/draft/regenerate` | admin | Force a new draft |
| POST | `/api/tickets/:id/classify` | admin | Re-run classification |
| GET | `/api/admin/stats` | admin | Queue health, AI usage/cost, override and adoption rates |
| GET | `/api/admin/users` | admin | Admins (for assignment) |
| GET | `/api/events` | any | SSE stream of ticket changes (role-filtered) |
| GET | `/api/health` | public | Liveness + AI status |

**Errors** always use `{ "error": { "code", "message", "details?" } }` with a specific status:
- `400`: `BAD_REQUEST` with per-field `details`, `INVALID_JSON`, or `INVALID_ATTACHMENT`.
- `401`: `UNAUTHORIZED` or `INVALID_CREDENTIALS`.
- `403`: `FORBIDDEN`.
- `404`: `NOT_FOUND` or `ROUTE_NOT_FOUND`.
- `409`: `CONFLICT` (e.g. replying to a closed ticket).
- `429`: `TOO_MANY_ATTEMPTS`.

Unknown fields on `PATCH` are rejected. Unexpected errors are logged with context and return a generic `500` without internals.

---

## 5. Testing

```bash
npm test     # requires the seeded local database
```

- **`ai/ai.test.ts`** (unit) covers:
  - royalty payout date math, including year boundaries;
  - the threshold and overdue logic;
  - the fallback classifier against the sample queries from the brief;
  - template drafts;
  - prompt invariants: system prompts byte-stable for caching, KB scoped per category, untrusted text kept out of the system prompt.
- **`ai/llm.test.ts`** runs the real Anthropic SDK against a local fake Messages API. It checks:
  - the request shape (cache breakpoints, JSON schema, effort);
  - response parsing and usage logging;
  - 429 → retries → circuit breaker opening;
  - schema-invalid output being rejected without tripping the breaker.
- **`api.test.ts`** (supertest) covers:
  - authentication, and every route being protected;
  - authors isolated from each other (404s) and never receiving triage fields;
  - admin-only endpoints;
  - validation errors;
  - the template-draft fallback.

The UI was checked end to end in headless Chrome: author submits a ticket → admin sees it classified and replies from the draft → the author's open page shows the reply and the status change without a refresh.

---

## 6. Deployment

The same codebase runs on two kinds of host. In both, the browser sees a single origin, so the session cookie works without CORS.

### Vercel + Neon Postgres (live demo)

- The React build is served from Vercel's CDN.
- [`api/index.ts`](api/index.ts) runs the same Express app as a serverless function. [`vercel.json`](vercel.json) routes `/api/*` to it.
- Serverless-specific behaviour, switched on automatically by the `VERCEL` env var:

| Concern | Long-running server (Docker) | Vercel |
|---|---|---|
| Live updates | SSE push | The client polls every 5 s while the tab is visible. `/api/health` tells the client which mode to use. |
| Background AI classification | In-process queue | Same queue, kept alive after the response with `waitUntil` |
| Pending tickets after deploy | Re-queued on boot | Re-queued on each cold start |
| Attachments | `server/uploads/` | `/tmp` (ephemeral, see limitations) |

Steps:

**How the app connects to Neon:**
- **App queries** use `DATABASE_URL`, the pooled `-pooler` endpoint (PgBouncer). They go through Prisma's node-postgres driver adapter (`@prisma/adapter-pg`). On Vercel, `attachDatabasePool` closes idle connections before a function instance is suspended. See [`server/src/lib/prisma.ts`](server/src/lib/prisma.ts).
- **Prisma Migrate** uses `DATABASE_URL_UNPOOLED` (`directUrl` in the schema), because migrations need a session that PgBouncer's transaction mode doesn't provide.

Steps:

1. **Database.** The project is linked to Neon through `neon.ts` / `.neon`. `neon deploy` writes `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `NEON_BRANCH` to `.env.local` (gitignored). The `dev` and `db:*` scripts load `.env.local` ahead of `server/.env`, so a Neon setup automatically replaces the Docker database.
2. **Migrate and seed:**
   ```bash
   npm run db:deploy -w server     # applies migrations over the direct connection
   npm run db:seed -w server       # loads the dataset (wipes app tables first)
   ```
3. **Deploy:**
   ```bash
   vercel login
   vercel link                                      # repo root, no framework changes needed
   vercel env add DATABASE_URL production           # pooled URL from .env.local
   vercel env add DATABASE_URL_UNPOOLED production  # direct URL from .env.local
   vercel env add JWT_SECRET production             # long random string
   vercel env add ANTHROPIC_API_KEY production
   vercel --prod
   ```
   Alternatively, import the GitHub repo in the Vercel dashboard and add the same four environment variables.

### Docker (Render or any container host)

The image serves the API and the built React app from one process. On boot it runs `prisma migrate deploy`, seeds the dataset **only if the database is empty**, then starts.

**Render (blueprint included):** push the repo → Render → *New → Blueprint* → pick the repo. [`render.yaml`](render.yaml) provisions Postgres and the web service and generates `JWT_SECRET`. Then set `ANTHROPIC_API_KEY` in the service's Environment tab.

**Anywhere else:** `docker build -t bookleaf-support .` then run the image with `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (the same value unless your provider has a separate pooler), `JWT_SECRET` and (optionally) `ANTHROPIC_API_KEY`. It listens on `PORT` (default 4000).

---

## 7. Known limitations & next steps

- **Single instance.** The SSE event bus and the classification queue are in-process. Scaling out would need Postgres `LISTEN/NOTIFY` or Redis pub/sub for events, and a durable queue (pg-boss/BullMQ) for AI jobs.
- **Attachments are stored on local disk** (`/tmp` on Vercel), which is ephemeral on most hosts. An uploaded file may 404 later, and the UI handles that. Production would use S3/R2 or Vercel Blob with signed URLs and virus scanning.
- **Polling on Vercel.** Serverless functions can't hold SSE connections, so updates take up to 5 s there and cost one request per tab every 5 s. A hosted pub/sub (Pusher, Ably, Supabase Realtime) would restore push.
- **The AI has no image understanding yet.** Misprint photos could be passed to the model (Claude accepts images) to pre-verify reprint claims.
- **Classification quality is measured only by overrides.** Next would be a labelled eval set built from historical tickets, run on every prompt change, plus a review sample of sent AI-assisted replies.
- **No email notifications.** Authors see updates in-app in real time. A production system would also email on admin replies.
- **Auth is basic by design** (per the brief). There is no password reset, refresh-token rotation or SSO for staff.
- **SLA is a fixed 24-hour threshold** in the UI. It could become per-priority targets with breach alerts.
- **Royalty "overdue" detection is a heuristic** (no payout in 140+ days with a balance of ₹1,000 or more). With real payout records it would compare against the actual quarterly payout batches. Because the sample data's last payouts are from 2025, most authors with pending balances are currently flagged as possibly overdue. For those, drafts follow the KB's guidance for overdue payments: own the delay and escalate to finance with a 48-hour timeline.
