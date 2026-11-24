/**
 * Authentication probing shared by Re-detect and installation Stage 6.
 *
 * Never reads or returns credential material — only whether a provider has a
 * usable credential, and the provider's display name.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectInstallation } from "@/server/opencode/detector";
import { listModels } from "@/server/opencode/model-manager";
import type { OpenCodeClient } from "@/server/opencode/client";

const execFileAsync = promisify(execFile);

export interface AuthCheck {
  checked: boolean;
  authenticated: boolean;
  /** Provider display names that reported a usable credential. */
  providers: string[];
  /** How the verdict was obtained (for the technical details panel). */
  sources: string[];
  error?: string;
}

/** Strip ANSI colour codes before parsing CLI output. */
function stripAnsi(raw: string): string {
  const esc = String.fromCharCode(27);
  return raw
    .split(esc)
    .map((chunk, i) => (i === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, "")))
    .join("");
}

/** Ask the OpenCode CLI how many credentials it knows about (no values read). */
export async function cliCredentialCount(): Promise<{ count: number | null; raw: string }> {
  const info = await detectInstallation().catch(() => null);
  if (!info?.installed || !info.path) return { count: null, raw: "OpenCode CLI not found." };
  try {
    const { stdout, stderr } = await execFileAsync(info.path, ["auth", "list"], {
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const text = stripAnsi(`${stdout}\n${stderr}`);
    const m = text.match(/(\d+)\s+credentials?/i);
    return { count: m ? Number(m[1]) : null, raw: text.trim() };
  } catch (e) {
    return { count: null, raw: `auth list failed: ${(e as Error).message}` };
  }
}

/**
 * Determine whether at least one AI provider has a usable credential.
 * Uses the connected server's provider catalogue first (no secrets returned),
 * then cross-checks with the CLI when the server reports nothing.
 */
export async function checkAuthentication(
  client: OpenCodeClient | null,
  directory?: string
): Promise<AuthCheck> {
  const sources: string[] = [];
  const providers: string[] = [];

  if (client) {
    try {
      const catalogue = await listModels(client, directory);
      for (const p of catalogue.providers) {
        if (p.authenticated) providers.push(p.name || p.id);
      }
      sources.push(`server provider catalogue (${catalogue.providers.length} providers checked)`);
      if (providers.length > 0) {
        return { checked: true, authenticated: true, providers, sources };
      }
    } catch (e) {
      sources.push(`provider catalogue failed: ${(e as Error).message}`);
    }
  }

  const cli = await cliCredentialCount();
  sources.push(`opencode auth list: ${cli.count ?? "unavailable"}`);
  if (cli.count !== null && cli.count > 0) {
    return { checked: true, authenticated: true, providers, sources };
  }

  return {
    checked: Boolean(client) || cli.count !== null,
    authenticated: false,
    providers,
    sources,
    error: client ? undefined : "Not connected to an OpenCode server.",
  };
}
