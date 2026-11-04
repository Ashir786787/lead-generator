import os from "node:os";
import path from "node:path";

/**
 * Vitest global setup.
 *
 * Runs before every test file is imported, so the values below are in place
 * before `src/lib/env.ts` snapshots `process.env` (dotenv never overrides an
 * existing variable, so `.env` cannot flip these back).
 */
Object.assign(process.env, { NODE_ENV: "test" });
process.env.LOG_LEVEL = "silent";
process.env.SCAN_PER_HOST_DELAY_MS = "0";
process.env.SCAN_CONNECT_TIMEOUT_MS = "2000";
process.env.SCAN_TOTAL_TIMEOUT_MS = "5000";
process.env.STORAGE_DIR = path.join(os.tmpdir(), "leadfinder-tests", "storage");

// The private-target escape hatch is opt-in per test file (only the fixture
// server suite enables it) so SSRF rejection keeps being exercised for real.
delete process.env.ALLOW_PRIVATE_TARGETS_FOR_TESTS;
