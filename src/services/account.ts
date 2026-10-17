import { MOCK_ACCOUNT_INFO } from "@/data/mockData";

/** Mock account service — profile, export and deletion flows (no backend). */

export interface AccountInfo {
  email: string;
  name: string;
  created_at: number | null;
}

export interface ServerAccountExport {
  account: AccountInfo;
  settings: Record<string, unknown>;
}

export type DeletionState = "none" | "queued" | "running" | "retry_wait" | "failed" | "completed";
export type DeletionStage = "queued" | "deleting_data" | "removing_auth" | "verifying";

export const DELETION_STAGE_LABELS: Record<DeletionStage, string> = {
  queued: "Deletion queued",
  deleting_data: "Removing your data from Nexuss servers",
  removing_auth: "Removing your Firebase sign-in account",
  verifying: "Verifying that nothing was left behind"
};

export interface DeletionStatus {
  state: DeletionState;
  stage: DeletionStage | null;
  attempt: number;
  next_attempt_at: number | null;
  last_error: string | null;
  detail: string | null;
}

const NO_DELETION: DeletionStatus = {
  state: "none",
  stage: null,
  attempt: 1,
  next_attempt_at: null,
  last_error: null,
  detail: null
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getAccountInfo(): Promise<AccountInfo> {
  return delay(300).then(() => MOCK_ACCOUNT_INFO);
}

export function fetchServerExport(): Promise<ServerAccountExport> {
  return delay(500).then(() => ({
    account: MOCK_ACCOUNT_INFO,
    settings: { theme: "dark", provider: "groq", model: "openai/gpt-oss-120b" }
  }));
}

export function getDeletionStatus(): Promise<DeletionStatus> {
  return delay(200).then(() => NO_DELETION);
}

type FirebaseUserLike = {
  providerData?: Array<{ providerId: string }> | null;
} | null;

export function getReauthMethod(user: FirebaseUserLike): "password" | "popup" {
  const providers = user?.providerData?.map((entry) => entry.providerId) ?? [];
  return providers.includes("password") ? "password" : "popup";
}

export async function reauthenticateWithPassword(password: string): Promise<void> {
  await delay(500);
  if (password.length < 4) throw new Error("The password you entered is incorrect.");
}

export async function reauthenticateWithGoogle(): Promise<void> {
  await delay(500);
}

export async function startAccountDeletion(): Promise<DeletionStatus> {
  await delay(600);
  return { ...NO_DELETION, state: "queued" };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
