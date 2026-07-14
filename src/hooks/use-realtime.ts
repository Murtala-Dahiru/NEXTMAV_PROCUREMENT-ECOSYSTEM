// NextMav Procure — Real-time notification hook
// Connects to the WebSocket mini-service for live updates.

"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useStore } from "@/lib/store";

interface RealtimeNotification {
  id: string;
  userId?: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  timestamp: string;
}

interface PresenceUser {
  userId: string;
}

export function useRealtimeNotifications() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const isAuthed = useStore((s) => s.isAuthed);
  const currentUserId = useStore((s) => s.currentUserId);
  const organization = useStore((s) => s.organization);

  useEffect(() => {
    if (!isAuthed || !currentUserId) return;

    // Connect to WebSocket mini-service on port 3003
    const socket = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      // Identify ourselves
      socket.emit("identify", {
        userId: currentUserId,
        organizationId: organization.id,
      });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connected", (data: { message: string }) => {
      console.log("[NextMav Realtime]", data.message);
    });

    // Real-time notifications
    socket.on("notification", (notification: RealtimeNotification) => {
      // Use store directly to add notification
      const store = useStore.getState();
      // Only add if it's for this user or broadcast
      if (!notification.userId || notification.userId === currentUserId) {
        const newNotification = {
          id: notification.id,
          organizationId: organization.id,
          userId: currentUserId,
          title: notification.title,
          message: notification.message,
          type: notification.type as any,
          read: false,
          link: notification.link,
          createdAt: notification.timestamp,
        };
        // Add to notifications via set
        useStore.setState((s) => ({
          notifications: [newNotification, ...s.notifications],
        }));

        // Show toast
        import("sonner").then(({ toast }) => {
          const variant = notification.type === "success" ? "success" : notification.type === "error" ? "error" : notification.type === "warning" ? "warning" : "info";
          toast[variant](notification.title, { description: notification.message });
        });
      }
    });

    // Presence updates
    socket.on("presence-update", (data: { onlineUsers: PresenceUser[] }) => {
      setOnlineUsers(data.onlineUsers);
    });

    // Activity events
    socket.on("activity", (data: { eventType: string; description: string; timestamp: string }) => {
      const store = useStore.getState();
      useStore.setState((s) => ({
        activities: [
          {
            id: `act_rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            organizationId: organization.id,
            eventType: data.eventType as any,
            description: data.description,
            severity: "INFO" as const,
            createdAt: data.timestamp,
          },
          ...s.activities,
        ],
      }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthed, currentUserId, organization.id]);

  // Helper to send a notification
  const sendNotification = (notification: Omit<RealtimeNotification, "id" | "timestamp">) => {
    socketRef.current?.emit("send-notification", {
      ...notification,
      organizationId: organization.id,
    });
  };

  return { isConnected, onlineUsers, sendNotification };
}
