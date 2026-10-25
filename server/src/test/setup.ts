import fs from "node:fs";

// Runs before any test module is imported, so config/env sees these values.
if (fs.existsSync(".env")) process.loadEnvFile(".env");
// Force the no-AI path so tests are deterministic and never spend tokens.
// (Provider tests opt back in with a fake API server.)
process.env.AI_PROVIDER = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.AI_MODEL = "";
