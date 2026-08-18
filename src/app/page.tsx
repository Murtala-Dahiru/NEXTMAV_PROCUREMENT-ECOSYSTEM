"use client";

import { useEffect } from "react";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { LoginView } from "@/components/views/login-view";
import { AppShell } from "@/components/shell/app-shell";

export default function Home() {
  const isAuthed = useStore((s) => s.isAuthed);
  const sessionChecked = useStore((s) => s.sessionChecked);
  const hydrated = useStore((s) => s.hydrated);
  const loadError = useStore((s) => s.loadError);
  const theme = useStore((s) => s.theme);
  const restoreSession = useStore((s) => s.restoreSession);
  const refresh = useStore((s) => s.refresh);

  // Apply theme class on mount and whenever it changes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Ask the server whether this browser already holds a valid session, so a page
  // refresh keeps you signed in instead of dropping you back to the login screen.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  if (!sessionChecked) return <BootScreen label="Restoring your session…" />;
  if (!isAuthed) return <LoginView />;

  if (loadError) {
    return (
      <BootScreen
        variant="error"
        label="We could not load your organization's data"
        detail={loadError}
        action={{ label: "Try again", onClick: () => void refresh() }}
      />
    );
  }

  // The shell is held back until real data has arrived. Rendering it earlier
  // would briefly show empty tables and zeroed metrics as though they were real.
  if (!hydrated) return <BootScreen label="Loading your workspace…" />;

  return <AppShell />;
}

function BootScreen({
  label,
  detail,
  variant = "loading",
  action,
}: {
  label: string;
  detail?: string;
  variant?: "loading" | "error";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Sparkles size={18} />
        </div>
        <span className="text-lg font-semibold tracking-tight text-foreground">NextMav Procure</span>
      </div>

      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        {variant === "loading" ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" />
            {label}
          </span>
        ) : (
          <>
            <TriangleAlert size={20} className="text-amber-500" />
            <p className="text-sm font-medium text-foreground">{label}</p>
            {detail && <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>}
          </>
        )}

        {action && (
          <button
            onClick={action.onClick}
            className="mt-2 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
