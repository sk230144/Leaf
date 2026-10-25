/**
 * Vercel serverless entry point. Every /api/* request is rewritten here (see
 * vercel.json) and handled by the same Express app used in Docker/local.
 */
import { waitUntil } from "@vercel/functions";
import { createApp } from "../server/src/app";
import { requeuePendingClassifications } from "../server/src/ai/jobs";

const app = createApp();

// No boot hook on serverless: on each cold start, pick up tickets still
// waiting for classification (e.g. freshly seeded ones).
waitUntil(requeuePendingClassifications().catch((error) => console.error("Requeue failed", error)));

export default app;
