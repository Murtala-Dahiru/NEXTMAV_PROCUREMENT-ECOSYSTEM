// NextMav Procure — Topbar with global search, notifications, theme toggle, user menu

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  UserCircle,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useCurrentUser, useUnreadNotificationCount } from "@/lib/store";
import { Avatar } from "@/components/shared";
import { ROLE_LABELS } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const user = useCurrentUser();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const navigate = useStore((s) => s.navigate);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const logout = useStore((s) => s.logout);
  const notifications = useStore((s) => s.notifications);
  const markAllRead = useStore((s) => s.markAllNotificationsRead);
  const markRead = useStore((s) => s.markNotificationRead);
  const unreadCount = useUnreadNotificationCount();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border glass">
      <div className="flex h-full items-center gap-3 px-4 lg:px-6">
        <button
          onClick={onMenuClick}
          className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Toggle menu"
        >
          <Menu size={18} />
        </button>

        {/* Search trigger */}
        <button
          onClick={() => setCommandOpen(true)}
          className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted hover:border-border/80 transition-colors"
        >
          <Search size={15} className="shrink-0" />
          <span className="truncate">Search requests, vendors, POs…</span>
          <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-border bg-popover shadow-xl shadow-foreground/5 overflow-hidden z-50"
                  >
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Notifications</p>
                        <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
                      </div>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors flex items-center gap-1"
                        >
                          <Check size={13} />
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                          <Bell size={20} className="mx-auto mb-2 opacity-40" />
                          No notifications yet
                        </div>
                      ) : (
                        notifications.slice(0, 8).map((n) => (
                          <button
                            key={n.id}
                            onClick={() => {
                              markRead(n.id);
                              if (n.link) navigate(n.link as never);
                              setNotifOpen(false);
                            }}
                            className={cn(
                              "group flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left hover:bg-muted/50 transition-colors last:border-0",
                              !n.read && "bg-emerald-50/40 dark:bg-emerald-950/15"
                            )}
                          >
                            <div
                              className={cn(
                                "mt-1.5 h-2 w-2 rounded-full shrink-0",
                                n.type === "success" && "bg-emerald-500",
                                n.type === "approval" && "bg-amber-500",
                                n.type === "warning" && "bg-orange-500",
                                n.type === "error" && "bg-rose-500",
                                n.type === "info" && "bg-sky-500"
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1">{formatRelativeTime(n.createdAt)}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    <button
                      onClick={() => {
                        navigate("notifications");
                        setNotifOpen(false);
                      }}
                      className="block w-full border-t border-border bg-muted/30 py-2.5 text-center text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                    >
                      View all notifications
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md p-1 hover:bg-muted transition-colors"
            >
              <Avatar initials={user.initials} color={user.avatarColor} size="sm" />
              <div className="hidden sm:block text-left">
                <p className="text-xs font-medium text-foreground leading-tight max-w-[120px] truncate">{user.name}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{ROLE_LABELS[user.role]}</p>
              </div>
              <ChevronDown size={14} className="text-muted-foreground hidden sm:block" />
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 mt-2 w-60 rounded-xl border border-border bg-popover shadow-xl shadow-foreground/5 overflow-hidden z-50"
                  >
                    <div className="border-b border-border px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar initials={user.initials} color={user.avatarColor} size="md" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {ROLE_LABELS[user.role]}
                      </div>
                    </div>
                    <div className="p-1.5">
                      <button
                        onClick={() => {
                          navigate("settings");
                          setUserMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <UserCircle size={15} className="text-muted-foreground" />
                        Profile
                      </button>
                      <button
                        onClick={() => {
                          navigate("settings");
                          setUserMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Users size={15} className="text-muted-foreground" />
                        Team Members
                      </button>
                      <button
                        onClick={() => {
                          navigate("settings");
                          setUserMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Settings size={15} className="text-muted-foreground" />
                        Settings
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        onClick={logout}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
