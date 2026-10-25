import fs from "node:fs";

// Runs before any test module is imported, so config/env sees these values.
if (fs.existsSync(".env")) process.loadEnvFile(".env");
// Force the no-AI path so tests are deterministic and never spend tokens.
process.env.ANTHROPIC_API_KEY = "";
