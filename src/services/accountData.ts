/** Mock local account-data helpers used by the Account screen. */

export async function gatherLocalAccountExport(_uid: string): Promise<Record<string, unknown>> {
  return { chats: [], messages: [], note: "Prototype export — no local database is attached." };
}

export async function purgeLocalAccountData(_uid: string): Promise<void> {
  return Promise.resolve();
}
