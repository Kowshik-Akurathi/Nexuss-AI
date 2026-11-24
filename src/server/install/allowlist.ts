/**
 * Explicit allowlist of every external command the installation manager may run.
 *
 * Security rules enforced here:
 *  - The frontend only ever sends actions ("start", "cancel", …). It can never
 *    contribute argv, so no arbitrary command can reach the shell.
 *  - Every command is a fixed argv template filled with values this module
 *    itself derived (never user input).
 *  - Nothing here kills, overwrites or rewrites existing user configuration.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstallerMethodId = "npm" | "script" | "brew";

/** Official npm package published for the OpenCode CLI. */
export const OPENCODE_NPM_PACKAGE = "opencode-ai";
/** Official install script referenced by the OpenCode docs / detector guidance. */
export const OPENCODE_INSTALL_SCRIPT = "https://opencode.ai/install";
/** Official Homebrew tap referenced by the OpenCode docs / detector guidance. */
export const OPENCODE_BREW_TAP = "anomalyco/tap/opencode";

export interface CommandSpec {
  /** Executable name resolved through PATH (never an absolute attacker path). */
  file: string;
  args: string[];
  /** Fixed shell string used only where a pipeline is unavoidable. */
  shellCommand?: string;
}

export function npmInstallCommand(): CommandSpec {
  return {
    file: "npm",
    args: ["install", "-g", OPENCODE_NPM_PACKAGE, "--no-fund", "--no-audit", "--loglevel", "info"],
  };
}

export function npmPrefixCommand(): CommandSpec {
  return { file: "npm", args: ["prefix", "-g"] };
}

export function versionCommand(bin: string): CommandSpec {
  return { file: bin, args: ["--version"] };
}

export function scriptInstallCommand(): CommandSpec {
  // Piped official installer; the shell string is a constant, not user input.
  return {
    file: "bash",
    args: ["-c", `curl -fsSL ${OPENCODE_INSTALL_SCRIPT} | bash`],
    shellCommand: `curl -fsSL ${OPENCODE_INSTALL_SCRIPT} | bash`,
  };
}

export function brewInstallCommand(): CommandSpec {
  return { file: "brew", args: ["install", OPENCODE_BREW_TAP] };
}

/** Non-interactive elevation prefix (unix only). Never prompts for a password. */
export function sudoPrefix(spec: CommandSpec): CommandSpec {
  return { file: "sudo", args: ["-n", spec.file, ...spec.args] };
}

/** Allowlisted command used to terminate ONLY a child we spawned (Windows). */
export function taskkillTree(pid: number): CommandSpec {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid pid");
  return { file: "taskkill", args: ["/pid", String(pid), "/T", "/F"] };
}

export interface ToolAvailability {
  npm: boolean;
  npmVersion: string | null;
  npmPrefix: string | null;
  curl: boolean;
  wget: boolean;
  bash: boolean;
  brew: boolean;
}

async function which(bin: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(cmd, [bin], { timeout: 8000, windowsHide: true });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

async function capture(file: string, args: string[], timeoutMs = 15_000): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(file),
    });
    return `${stdout}${stderr}`.trim();
  } catch {
    return null;
  }
}

/** Probe which supported installation tools exist on this machine. */
export async function detectTools(): Promise<ToolAvailability> {
  const npmPath = await which("npm");
  const [curl, wget, bash, brew] = await Promise.all([
    which("curl"),
    which("wget"),
    which("bash"),
    which("brew"),
  ]);

  let npmVersion: string | null = null;
  let npmPrefix: string | null = null;
  if (npmPath) {
    npmVersion = await capture("npm", ["--version"]);
    npmPrefix = await capture("npm", ["prefix", "-g"]);
    if (!npmPrefix) npmPrefix = null;
  }

  return {
    npm: Boolean(npmPath),
    npmVersion,
    npmPrefix,
    curl: Boolean(curl),
    wget: Boolean(wget),
    bash: Boolean(bash),
    brew: Boolean(brew),
  };
}

/**
 * True when the npm global prefix directory is writable by this process.
 * Used to decide whether an installation needs elevated permissions — we never
 * escalate without asking first.
 */
export function npmPrefixWritable(prefix: string | null): boolean {
  if (!prefix) return false;
  try {
    fs.accessSync(prefix, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function userWritableFallback(): boolean {
  // On Windows npm's global prefix lives under the user profile by default.
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData && npmPrefixWritable(appData)) return true;
    return npmPrefixWritable(path.join(os.homedir(), "AppData", "Roaming", "npm"));
  }
  return false;
}

/** Pick the install method for this OS, preferring the most reliable option. */
export function selectMethod(tools: ToolAvailability): InstallerMethodId | null {
  if (tools.npm) return "npm";
  if (process.platform !== "win32") {
    if (tools.bash && (tools.curl || tools.wget)) return "script";
    if (tools.brew) return "brew";
  }
  return null;
}
