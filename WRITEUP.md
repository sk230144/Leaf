# Approach: BookLeaf Author Support Portal

## What I prioritised

**1. A ticket flow that never depends on the AI.** The brief's real problem is backlog and inconsistency at scale, so the first thing I made solid was the ticket lifecycle: submit, triage, reply, resolve, with real-time updates on both sides. AI is layered on top and is never on the critical path:
- Tickets are created instantly and classified in a background job.
- If the model is down, rate-limited or not configured, keyword rules classify the ticket and a category template pre-fills the reply.
- Both fallbacks are labelled in the UI, so admins know to double-check them.

**2. AI that knows the author's account, not just the policy.** A reply like "royalties are paid quarterly" is generic AI fluff. The useful reply is "your ₹850 is below the ₹1,000 threshold and rolls over", or "you've had ₹2,546 pending since July 2024; that's on us, finance will resolve it within 48 hours". To get there:
- Code computes the facts the model shouldn't guess: payout deadlines, threshold status, overdue signals, production stage.
- The model writes from those facts plus the relevant section of the knowledge base.
- Where it lacks a fact (bank details, shipment dates), it leaves a visible placeholder for the admin instead of inventing one.

**3. Cost and reliability as design constraints, not afterthoughts:**
- One call does both category and priority.
- Prompts are static and cached.
- Only the category's KB sections are sent.
- Drafts are cached per conversation state.
- Contexts are bounded.
- A circuit breaker sits in front of the API.
- Every call's tokens are logged and shown on the admin dashboard.

**4. Things an ops team would actually use:**
- An urgency-sorted queue with an SLA flag.
- Assign-to-me.
- Overrides that automation never overwrites.
- An audit log.
- Escalation suggestions that become internal notes in one click.

## Trade-offs

- **SSE and an in-process queue rather than Redis or a job broker.** Simple, with fewer moving parts to deploy, and enough for one instance. The cost is horizontal scaling (see below).
- **Haiku over a larger model.** The tasks are narrow and grounded in supplied facts, so the cheaper, faster model is the right default. The model is one env var if review shows the drafts need more.
- **Templates and rules as fallbacks.** They're deliberately simple and transparent rather than clever. Their job is to keep the desk running, not to compete with the model.
- **Attachments on local disk** and **basic email/password auth**, as the brief allows. Both are flagged as limitations.

## Evolving this into a production system

1. **Measure quality before tuning it.** Build a labelled eval set from historical tickets. Track classification accuracy (admin override rate is already recorded) and draft adoption (whether sent replies started from the AI draft is already recorded). Gate prompt and model changes on the eval.
2. **Scale-out.** Move to Postgres `LISTEN/NOTIFY` or Redis for real-time fan-out and a durable queue (pg-boss) for AI jobs, store attachments on S3, and run several stateless API replicas.
3. **Close the loop with authors.** Email notifications on replies, and self-service answers before a ticket is filed: show the payout schedule or production status inline when the subject matches. That deflects the most common queries entirely.
4. **Richer AI where it pays off:**
   - vision on misprint photos to pre-verify reprint claims;
   - summarising long threads for handover;
   - routing to the right team from the escalation note;
   - auto-resolving clearly informational tickets only after the eval shows it's safe.
5. **Ops maturity:** per-priority SLAs with alerts, staff SSO, structured log shipping and an AI spend budget alarm.
