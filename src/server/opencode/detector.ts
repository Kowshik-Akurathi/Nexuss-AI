import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LabError } from "../errors";

const execFileAsync = promisify(execFile);

export interface InstallationInfo {
  installed: boolean;
  path?: string;
  version?: string;
  method?: "PATH" | "npm-global" | "known-location" | "env" | "none";
  npmPackage?: string;
  guidance?: string;
  checkedAt: number;
  diagnostics: string[];
}

const NPM_BIN = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "npm"
);

function knownCandidatePaths(): string[] {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const out: string[] = [];
  if (process.platform === "win32") {
    out.push(
      // npm shim -> real native binary (spawn() refuses .cmd/.ps1 on Node >= 18/24)
      path.join(NPM_BIN, "node_modules", "opencode-ai", "bin", "opencode.exe"),
      path.join(NPM_BIN, "opencode.cmd"),
      path.join(NPM_BIN, "opencode.ps1"),
      path.join(localAppData, "Programs", "opencode", "opencode.exe"),
      path.join(home, ".local", "bin", "opencode.exe"),
      path.join(home, ".opencode", "bin", "opencode.exe"),
      path.join(home, "scoop", "shims", "opencode.exe")
    );
  } else {
    out.push(
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
      path.join(home, ".local", "bin", "opencode"),
      path.join(home, ".bun", "bin", "opencode"),
      "/opt/homebrew/bin/opencode"
    );
  }
  const envPath = process.env.OPENCODE_PATH;
  if (envPath) out.unshift(envPath);
  return out;
}

/**
 * Resolve a discovered entry point to something spawn() can actually execute.
 * On Windows the npm global bin contains .cmd/.ps1 shims plus an extensionless
 * shell script; Node's spawn() rejects those with EINVAL, so we map the npm shim
 * to the package's real binary when it is present.
 */
function resolveExecutable(bin: string): string {
  if (process.platform !== "win32") return bin;
  const ext = path.extname(bin).toLowerCase();
  if (ext === ".exe") return bin;
  if (ext === ".cmd" || ext === ".bat" || ext === ".ps1") {
    const exe = path.join(path.dirname(bin), "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return bin;
}

/** Strip ANSI colour codes that `opencode --version` can emit. */
export function parseVersion(raw: string): string | undefined {
  const esc = String.fromCharCode(27);
  const cleaned = raw.split(esc).map((chunk, i) => (i === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, ""))).join("");
  const m = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : undefined;
}

async function runVersion(bin: string): Promise<string> {
  const target = resolveExecutable(bin);
  const { stdout, stderr } = await execFileAsync(target, ["--version"], {
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    // .cmd/.bat cannot be spawned directly; a fixed argument list keeps this safe.
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(target),
  });
  return `${stdout}\n${stderr}`;
}

/**
 * Detect the OpenCode installation using supported system methods only:
 * PATH lookup, the npm global bin directory, well-known install locations
 * and an explicit OPENCODE_PATH override. Never guesses a working directory.
 */
export async function detectInstallation(): Promise<InstallationInfo> {
  const diagnostics: string[] = [];
  const checkedAt = Date.now();
  const candidates: { bin: string; method: InstallationInfo["method"] }[] = [];

  const envPath = process.env.OPENCODE_PATH;
  if (envPath) candidates.push({ bin: envPath, method: "env" });

  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(whichCmd, ["opencode"], { timeout: 10_000, windowsHide: true });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) {
      candidates.push({ bin: first, method: "PATH" });
      diagnostics.push(`PATH lookup resolved: ${first}`);
    } else {
      diagnostics.push("PATH lookup returned no result for 'opencode'.");
    }
  } catch (e) {
    diagnostics.push(`PATH lookup failed: ${(e as Error).message}`);
  }

  for (const p of knownCandidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        candidates.push({ bin: p, method: p.startsWith(NPM_BIN) ? "npm-global" : "known-location" });
        diagnostics.push(`Candidate exists: ${p}`);
      }
    } catch (e) {
      diagnostics.push(`Candidate check failed for ${p}: ${(e as Error).message}`);
    }
  }

  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.bin)) continue;
    seen.add(c.bin);
    try {
      const raw = await runVersion(c.bin);
      const version = parseVersion(raw);
      if (version) {
        diagnostics.push(`Version probe OK (${c.method}): ${version}`);
        const info: InstallationInfo = {
          installed: true,
          path: c.bin,
          version,
          method: c.method,
          checkedAt,
          diagnostics,
        };
        if (c.method === "npm-global" || c.method === "PATH") info.npmPackage = "opencode-ai";
        return info;
      }
      diagnostics.push(`Version probe produced no semver for ${c.bin}`);
    } catch (e) {
      diagnostics.push(`Version probe failed for ${c.bin}: ${(e as Error).message}`);
    }
  }

  return {
    installed: false,
    method: "none",
    checkedAt,
    diagnostics,
    guidance:
      "OpenCode was not found on PATH, in the npm global bin directory, or in well-known install locations.\n\n" +
      "Install it with one of:\n" +
      "  npm install -g opencode-ai\n" +
      "  curl -fsSL https://opencode.ai/install | bash\n" +
      "  brew install anomalyco/tap/opencode\n\n" +
      "Or set OPENCODE_PATH in the Lab .env.local to the absolute path of the binary.",
  };
}

export function requireInstallation(info: InstallationInfo): InstallationInfo {
  if (!info.installed || !info.path) {
    throw new LabError({
      code: "OPENCODE_NOT_INSTALLED",
      message: "OpenCode is not installed (or not discoverable).",
      detail: info.diagnostics.join("\n"),
      recovery: info.guidance,
    });
  }
  return info;
}
