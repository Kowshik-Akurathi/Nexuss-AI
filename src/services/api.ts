/** No-op stand-ins for the prototype's HTTP layer. */

export function clearAuthCache(): void {
  /* intentionally empty */
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  void path;
  void init;
  throw new Error("The prototype does not talk to a backend.");
}
