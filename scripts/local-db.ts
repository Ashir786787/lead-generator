import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import "dotenv/config";
import { spawn } from "node:child_process";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const USER = process.env.LOCAL_PG_USER ?? "leadfinder";
const PASSWORD = process.env.LOCAL_PG_PASSWORD ?? "leadfinder";
const DATABASE = process.env.LOCAL_PG_DATABASE ?? "leadfinder";
const DATA_DIR = path.resolve(process.env.LOCAL_PG_DATA_DIR ?? ".data/pg");

function resolvePlatformPackage(): string | null {
  const requireFromPg = createRequire(path.resolve("node_modules/embedded-postgres/dist/index.js"));
  const candidates = [
    "@embedded-postgres/windows-x64",
    "@embedded-postgres/darwin-arm64",
    "@embedded-postgres/darwin-x64",
    "@embedded-postgres/linux-x64",
    "@embedded-postgres/linux-arm64",
  ];
  for (const name of candidates) {
    try {
      return path.dirname(requireFromPg.resolve(`${name}/package.json`));
    } catch {
      /* not the current platform */
    }
  }
  return null;
}

function pgCtlPath(): string {
  const pkgDir = resolvePlatformPackage();
  if (!pkgDir) throw new Error("No embedded-postgres platform package installed.");
  const exe = process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
  return path.join(pkgDir, "native", "bin", exe);
}

function makeInstance() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    authMethod: "scram-sha-256",
    persistent: true,
    createPostgresUser: false,
    autoRehydrateSymlinks: true,
    onLog: (m) => {
      if (process.env.LOCAL_PG_VERBOSE === "true") console.log(m);
    },
    onError: (m) => console.error(m),
  });
}

async function isHealthy(): Promise<boolean> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function ensureDatabase(pg: EmbeddedPostgres) {
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${DATABASE}"`);
      console.log(`Created database ${DATABASE}`);
    }
  } finally {
    await client.end();
  }
}

async function up() {
  if (await isHealthy()) {
    console.log(`Postgres already running on 127.0.0.1:${PORT}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pg = makeInstance();
  const initialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
  if (!initialised) {
    console.log(`Initialising Postgres cluster in ${DATA_DIR} …`);
    await pg.initialise();
  }
  console.log(`Starting Postgres on 127.0.0.1:${PORT} …`);
  await pg.start();
  await ensureDatabase(pg);
  console.log(`Postgres ready: postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`);
  console.log("Press Ctrl+C to stop. Run `pnpm db:down` from another terminal if needed.");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("Stopping Postgres …");
    try {
      await pg.stop();
    } catch (error) {
      console.error(error);
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // keep alive
  setInterval(() => undefined, 60_000);
}

async function down() {
  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log("No local cluster found.");
    return;
  }
  const exe = pgCtlPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ["-D", DATA_DIR, "stop", "-m", "fast"], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pg_ctl exited ${code}`))));
    child.on("error", reject);
  });
}

async function status() {
  const healthy = await isHealthy();
  console.log(healthy ? `Postgres running on 127.0.0.1:${PORT}` : "Postgres not running");
  process.exit(healthy ? 0 : 1);
}

const command = process.argv[2];
const run = command === "up" ? up : command === "down" ? down : command === "status" ? status : null;
if (!run) {
  console.error("Usage: tsx scripts/local-db.ts <up|down|status>");
  process.exit(1);
}
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
