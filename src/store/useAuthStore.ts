import { create } from "zustand";
import { MOCK_USER } from "@/data/mockData";

/**
 * Mock auth store. The prototype always starts inside the authenticated app;
 * "Log out" only flips this flag so the signed-out transition can be reviewed
 * (there is no sign-in screen in this prototype — see README).
 */

interface MockUser {
  uid: string;
  email: string;
  displayName: string;
  providerData?: Array<{ providerId: string }>;
}

interface AuthState {
  user: MockUser | null;
  idToken: string | null;
  loading: boolean;
  initialized: boolean;
  setUser: (user: MockUser | null) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: { ...MOCK_USER, providerData: [{ providerId: "password" }] },
  idToken: "mock-token",
  loading: false,
  initialized: true,
  setUser: (user) => set({ user, loading: false }),
  signOut: async () => set({ user: null, idToken: null })
}));
