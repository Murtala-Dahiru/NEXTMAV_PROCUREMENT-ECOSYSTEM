"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/auth/redirect";
import { completeProvisioningAction } from "@/app/(auth)/actions";

export function FinishSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState<string | null>(null);
  // React runs effects twice in development's strict mode; establishing the
  // session twice would consume the refresh token and fail the second time.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const next = safeNext(searchParams.get("next"));
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(hash);

    const errorCode = params.get("error_code") ?? params.get("error");
    if (errorCode) {
      router.replace(`/auth-error?reason=${encodeURIComponent(errorCode)}`);
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      router.replace("/auth-error?reason=missing_code");
      return;
    }

    void (async () => {
      // `@supabase/ssr`'s browser client persists to cookies rather than local
      // storage, so the session established here is immediately visible to the
      // server on the very next navigation.
      const { error } = await supabaseBrowser().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        router.replace("/auth-error?reason=invalid_link");
        return;
      }

      // The auth identity now exists and is confirmed, but a sign-up interrupted
      // before its second write would still have no tenant behind it.
      const result = await completeProvisioningAction();
      if (!result.ok) {
        setFailed(result.message);
        return;
      }

      // Clear the tokens out of the address bar before leaving. They are already
      // stored; leaving them in the URL puts credentials into browser history.
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(next);
    })();
  }, [router, searchParams]);

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
        <Brand />
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <TriangleAlert size={20} className="text-amber-500" />
          <p className="text-sm font-medium text-foreground">
            We could not finish setting up your workspace
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{failed}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
      <Brand />
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={15} className="animate-spin" />
        Signing you in…
      </span>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
        <Sparkles size={18} />
      </div>
      <span className="text-lg font-semibold tracking-tight text-foreground">NextMav Procure</span>
    </div>
  );
}
