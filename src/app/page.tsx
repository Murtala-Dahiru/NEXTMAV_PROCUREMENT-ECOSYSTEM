"use client";

import { useStore } from "@/lib/store";
import { LoginView } from "@/components/views/login-view";
import { AppShell } from "@/components/shell/app-shell";
import { useEffect } from "react";

export default function Home() {
  const isAuthed = useStore((s) => s.isAuthed);
  const theme = useStore((s) => s.theme);

  // Apply theme class on mount and whenever it changes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return isAuthed ? <AppShell /> : <LoginView />;
}
