// NextMav Procure — supplier portal header and page frame.

"use client";

import Link from "next/link";
import { Building2, LogOut, Sparkles } from "lucide-react";

export function PortalChrome({
  contactName,
  companyName,
  buyerName,
  children,
}: {
  contactName: string;
  companyName: string;
  buyerName: string;
  children: React.ReactNode;
}) {
  const signOut = async () => {
    await fetch("/api/supplier/auth/logout", { method: "POST" });

    // A full navigation, not a router push. The tender data this page is holding
    // must not outlive the session it was loaded under, and a soft navigation
    // would preserve exactly the in-memory state we are trying to discard. The
    // lint rule prefers the soft route; here that is the wrong trade.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/supplier/login";
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/supplier" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Sparkles size={16} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-foreground">Supplier Portal</p>
              <p className="text-[11px] text-muted-foreground">{companyName}</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs text-muted-foreground">Trading with</p>
              <p className="flex items-center justify-end gap-1 text-xs font-medium text-foreground">
                <Building2 size={11} />
                {buyerName}
              </p>
            </div>
            <span className="hidden text-sm text-muted-foreground md:inline">{contactName}</span>
            <button
              onClick={() => void signOut()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </>
  );
}
