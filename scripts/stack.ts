import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

/**
 * Starts the web app and the pg-boss worker together so scans, imports and
 * score recalculation never sit in "queued" because a second terminal was
 * forgotten. The worker stays available on its own via `pnpm worker`.
 *
 * Usage: tsx scripts/stack.ts <dev|start>
 */
const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: tsx scripts/stack.ts <dev|start>");
  process.exit(1);
}

const root = process.cwd();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const tsxBin = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const children: Array<{ label: string; child: ChildProcess }> = [];
let shuttingDown = false;

function run(label: string, args: string[]): void {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, LEAD_FINDER_STACK: "1" },
  });

  children.push({ label, child });

  child.on("error", (error) => {
    console.error(`[stack] Could not start ${label}:`, error.message);
    void stopAll(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    console.error(`[stack] ${label} stopped (${reason}). Stopping the other process.`);
    void stopAll(typeof code === "number" && code !== 0 ? code : 1);
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // `tsx watch` and Next.js can spawn children. taskkill /T stops the tree,
    // which avoids a stray worker holding the pg-boss connection open.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

async function stopAll(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) killTree(child);
  // Give the children a moment to release the port and database connections.
  setTimeout(() => process.exit(exitCode), 1_500);
}

process.on("SIGINT", () => void stopAll(0));
process.on("SIGTERM", () => void stopAll(0));

console.log(`[stack] Starting web (${mode}) and jobs worker.`);
run("web", [nextBin, mode]);
run("worker", [tsxBin, ...(mode === "dev" ? ["watch"] : []), "src/worker/index.ts"]);
