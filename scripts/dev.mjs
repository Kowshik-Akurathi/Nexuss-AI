// Dev orchestrator: runs the migrated OpenCode API server (src/server) and the
// Vite dev server together, forwarding both outputs and shutting both down
// together. Uses the local node binaries directly so it works on Windows
// without shell wrappers.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

if (!fs.existsSync(tsxCli) || !fs.existsSync(viteBin)) {
  console.error("[nexuss] Missing dependencies — run `npm install` first.");
  process.exit(1);
}

const children = [];

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[nexuss] ${name} exited (${signal ?? code}) — stopping dev.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[nexuss] starting API server (src/server) + Vite dev server...");
start("api", [tsxCli, path.join("src", "server", "index.ts")]);
start("vite", [viteBin]);
