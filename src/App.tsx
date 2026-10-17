import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatPage from "@/components/ChatPage";
import { useChatStore, useAuthStore, useLocalModelStore } from "@/store";
import { NexussLogo } from "@/components/admin/NexussLogo";

/**
 * Nexuss internal application shell (prototype).
 * Starts directly inside the authenticated app — see README for scope notes.
 */
function MainApp() {
  const user = useAuthStore((s) => s.user);
  const hydrate = useChatStore((s) => s.hydrate);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Default the sidebar to open on desktop, closed on tablet/mobile.
  useEffect(() => {
    setSidebarOpen(window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    void hydrate().then(() => setReady(true));
    void useLocalModelStore.getState().hydrate();
  }, [hydrate]);

  if (!user) return <SignedOutScreen />;

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {ready ? (
        <ChatPage
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      ) : (
        <div className="flex h-full flex-1 items-center justify-center bg-background">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )}
    </div>
  );
}

function SignedOutScreen() {
  const setUser = useAuthStore((s) => s.setUser);
  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <NexussLogo size={40} color="currentColor" className="mx-auto text-foreground" />
        <h1 className="mt-4 text-sm font-semibold">You&apos;ve been signed out</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This prototype has no sign-in screen — jump straight back into the workspace to keep
          reviewing the interface.
        </p>
        <button
          type="button"
          onClick={() =>
            setUser({ uid: "mock-uid-001", email: "arjun@nexuss.in", displayName: "Arjun Mehta" })
          }
          className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 cursor-pointer"
        >
          Sign back in
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return <MainApp />;
}
