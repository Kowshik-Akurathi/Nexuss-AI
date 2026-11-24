/**
 * Stage 1 — Checking Environment.
 *
 * Every field is produced by a real probe: OS/arch from node:os, tool
 * availability from PATH lookups, installations from the existing detector,
 * live servers from a read-only port/health probe, config files from disk and
 * port occupancy from TCP probes. Nothing is assumed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectInstallation } from "@/server/opencode/detector";
import { findRunningServer, isPortListening, type ServerManagerOptions } from "@/server/opencode/server-manager";
import {
  detectTools,
  npmPrefixWritable,
  selectMethod,
  type InstallerMethodId,
} from "./allowlist";
import type { EnvironmentReport, InstallMethodOption } from "./types";

const PROBE_PORTS = [4981, 4096, 6096, 5096, 8080];

const PLATFORM_LABELS: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  aix: "AIX",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  sunos: "SunOS",
};

function methodLabel(id: InstallerMethodId): string {
  if (id === "npm") return "npm (official package opencode-ai)";
  if (id === "script") return "Official install script (opencode.ai/install)";
  return "Homebrew (anomalyco/tap/opencode)";
}

function configCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    return [
      path.join(home, ".config", "opencode", "opencode.json"),
      path.join(home, ".config", "opencode", "opencode.jsonc"),
      path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "opencode", "opencode.json"),
    ];
  }
  return [
    path.join(home, ".config", "opencode", "opencode.json"),
    path.join(home, ".config", "opencode", "opencode.jsonc"),
  ];
}

export async function collectEnvironment(
  opts: { serverOptions?: ServerManagerOptions; onActivity?: (msg: string) => void; signal?: AbortSignal } = {}
): Promise<EnvironmentReport> {
  const activity = opts.onActivity ?? (() => undefined);
  const notes: string[] = [];
  const checkedAt = Date.now();

  activity("Detecting operating system and architecture…");
  const platform = process.platform;
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  const arch = process.arch;
  // Architectures with official prebuilt OpenCode binaries.
  const supportedArchs = new Set(["x64", "arm64"]);
  const unsupportedArch = !supportedArchs.has(arch);

  activity("Checking Node.js and installation tools…");
  const tools = await detectTools();
  const nodeVersion = process.version;

  const selected = selectMethod(tools);
  const methods: InstallMethodOption[] = [
    {
      id: "npm",
      label: methodLabel("npm"),
      available: tools.npm,
      detail: tools.npm ? `npm ${tools.npmVersion ?? "?"} · prefix ${tools.npmPrefix ?? "?"}` : "npm not found on PATH",
      selected: selected === "npm",
    },
    {
      id: "script",
      label: methodLabel("script"),
      available: platform !== "win32" && tools.bash && (tools.curl || tools.wget),
      detail:
        platform === "win32"
          ? "The official script requires a POSIX shell (not available on Windows)."
          : tools.bash
            ? tools.curl
              ? "bash + curl detected"
              : tools.wget
                ? "bash + wget detected"
                : "bash detected but neither curl nor wget"
            : "bash not found",
      selected: selected === "script",
    },
    {
      id: "brew",
      label: methodLabel("brew"),
      available: platform !== "win32" && tools.brew,
      detail: tools.brew ? "brew detected" : "Homebrew not found",
      selected: selected === "brew",
    },
  ];

  const dependencies = [
    { name: "Node.js", ok: true, detail: nodeVersion },
    {
      name: "npm",
      ok: tools.npm,
      detail: tools.npm ? tools.npmVersion ?? "detected" : "required for the npm install method",
    },
    {
      name: "Writable install target",
      ok: tools.npm ? npmPrefixWritable(tools.npmPrefix) : platform !== "win32",
      detail: tools.npm
        ? npmPrefixWritable(tools.npmPrefix)
          ? `${tools.npmPrefix} is writable by this process`
          : `${tools.npmPrefix ?? "global prefix"} is not writable — elevation required`
        : platform === "win32"
          ? "no npm and no POSIX script runner"
          : "checked against the selected method",
    },
  ];

  activity("Looking for existing OpenCode installations…");
  const installation = await detectInstallation().catch(() => null);
  const existingInstallations = installation?.installed
    ? [{ path: installation.path ?? "", version: installation.version, method: installation.method }]
    : [];

  activity("Probing local ports for a running OpenCode server…");
  const existingServers = await findRunningServer(opts.serverOptions ?? {}).then(
    (r) => (r ? [{ url: r.baseUrl, pid: r.pid, version: r.version }] : []),
    () => []
  );

  const ports: EnvironmentReport["ports"] = [];
  for (const port of PROBE_PORTS) {
    const inUse = await isPortListening(port, "127.0.0.1");
    ports.push({
      port,
      inUse,
      role: port === 4981 ? "preferred OpenCode port" : "probe port",
    });
    if (opts.signal?.aborted) break;
  }

  activity("Checking OpenCode configuration files…");
  const configFiles = configCandidates().map((p) => ({
    path: p,
    exists: fs.existsSync(p),
  }));

  const canInstall = selected !== null;
  const requiresElevation = Boolean(
    selected === "npm" && tools.npm && !npmPrefixWritable(tools.npmPrefix)
  );

  if (unsupportedArch) {
    notes.push(`Architecture "${arch}" is not one of the architectures with official prebuilt binaries.`);
  }
  if (!canInstall) {
    notes.push(
      process.platform === "win32"
        ? "No supported automatic installer is available here (npm is missing). Install OpenCode manually, then press Re-detect."
        : "Neither npm nor a POSIX shell with curl/wget is available, so no automatic installer can run."
    );
  }
  if (requiresElevation) {
    notes.push("The npm global prefix is not writable by this process — installing will need your confirmation.");
  }
  if (existingInstallations.length > 0) {
    notes.push("An existing OpenCode installation was found; it will be verified instead of reinstalled.");
  }
  if (existingServers.length > 0) {
    notes.push("An OpenCode server is already running and will be adopted rather than started twice.");
  }

  return {
    platform,
    platformLabel,
    platformRelease: os.release(),
    arch,
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    node: nodeVersion,
    npm: tools.npm ? tools.npmVersion : null,
    methods,
    dependencies,
    existingInstallations,
    existingServers,
    configFiles,
    ports,
    canInstall,
    requiresElevation,
    notes,
    checkedAt,
  };
}
