// NextMav Procure — the authenticated client shell.
//
// Split out of `page.tsx` so the session check can stay on the server. By the time
// this mounts the caller is known to be a valid principal, so it no longer has any
// sign-in state to reason about: its only job is to load the organization's data
// and hold the first paint until that data is real.

"use client";

import { useEffect } from "react";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { AppShell } from "@/components/shell/app-shell";

export function AppClient() {
  const hydrated = useStore((s) => s.hydrated);
  const loadError = useStore((s) => s.loadError);
  const theme = useStore((s) => s.theme);
  const bootstrap = useStore((s) => s.bootstrap);
  const refresh = useStore((s) => s.refresh);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
        <span className="text-lg font-semibold tracking-tight text-foreground">
          NextMav Procure
        </span>
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
