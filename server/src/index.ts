import { env } from "./config/env";
import { createApp } from "./app";
import { requeuePendingClassifications } from "./ai/jobs";
import { aiStatus } from "./ai/llm";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

async function main() {
  await prisma.$connect();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    const ai = aiStatus();
    logger.info("Server listening", { port: env.PORT, env: env.NODE_ENV, aiEnabled: ai.enabled, model: ai.model });
    if (!ai.enabled) logger.warn("ANTHROPIC_API_KEY not set - running with rule-based classification and template drafts");
  });

  await requeuePendingClassifications();

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // SSE connections stay open; don't wait for them forever.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Failed to start server", { error: String(error) });
  process.exit(1);
});
