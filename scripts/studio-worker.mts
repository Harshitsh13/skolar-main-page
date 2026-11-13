/**
 * SKOLAR Studio background worker — entry point.
 *
 *   npm run studio:worker            run continuously (what the startup task launches)
 *   npm run studio:worker -- --once  run until today's target is met / queue idle, then exit
 *
 * Loads .env.local / .env from the project root (same configuration as the website),
 * so the worker and the Studio share one configuration on Windows and macOS alike.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const root = process.env.STUDIO_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.STUDIO_PROJECT_ROOT = root;
for (const f of [".env.local", ".env"]) loadEnvFile(path.join(root, f));

const logDir = path.join(process.env.STUDIO_DATA_DIR || path.join(root, ".studio-data"), "logs");
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `worker-${new Date().toISOString().slice(0, 10)}.log`);
const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* log file unavailable */
  }
};

const once = process.argv.includes("--once");

const { runWorker } = await import("../src/studio/core/worker");
const { storeInfo } = await import("../src/studio/core/store");

const info = storeInfo();
log(`SKOLAR Studio worker starting (${process.platform}, node ${process.version}). Store: ${info.kind} — ${info.reason}`);
if (info.kind === "none") {
  log("Studio storage is not configured. Exiting.");
  process.exit(1);
}

try {
  await runWorker({ once, log });
  log("Worker exited.");
  process.exit(0);
} catch (err) {
  log(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
}
