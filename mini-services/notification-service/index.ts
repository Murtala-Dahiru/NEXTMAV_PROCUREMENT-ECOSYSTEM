// NextMav Procure — Real-time Notification Service
// WebSocket mini-service that broadcasts procurement events to connected clients.
// Runs on port 3003.

import { createServer } from "http";
import { Server, Socket } from "socket.io";

interface NotificationPayload {
  id: string;
  organizationId: string;
  userId?: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "approval" | "error" | "mention" | "budget" | "sla";
  link?: string;
  entityId?: string;
  entityType?: string;
  timestamp: string;
}

interface ConnectedUser {
  socketId: string;
  userId: string;
  organizationId: string;
  connectedAt: Date;
}

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const connectedUsers = new Map<string, ConnectedUser>();
const organizationRooms = new Map<string, Set<string>>(); // orgId -> Set of socketIds

const generateId = () => `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

io.on("connection", (socket: Socket) => {
  console.log(`[NextMav Notifications] Socket connected: ${socket.id}`);

  // Client identifies itself
  socket.on("identify", (data: { userId: string; organizationId: string }) => {
    const { userId, organizationId } = data;
    if (!userId || !organizationId) return;

    const user: ConnectedUser = {
      socketId: socket.id,
      userId,
      organizationId,
      connectedAt: new Date(),
    };
    connectedUsers.set(socket.id, user);

    // Join organization room
    socket.join(`org:${organizationId}`);
    socket.join(`user:${userId}`);

    if (!organizationRooms.has(organizationId)) {
      organizationRooms.set(organizationId, new Set());
    }
    organizationRooms.get(organizationId)!.add(socket.id);

    console.log(`[NextMav Notifications] User ${userId} joined org ${organizationId}. Total connected: ${connectedUsers.size}`);

    // Send welcome
    socket.emit("connected", {
      message: "Connected to NextMav real-time notifications",
      userId,
      timestamp: new Date().toISOString(),
    });

    // Broadcast presence update
    io.to(`org:${organizationId}`).emit("presence-update", {
      onlineUsers: Array.from(connectedUsers.values())
        .filter((u) => u.organizationId === organizationId)
        .map((u) => ({ userId: u.userId })),
    });
  });

  // Send a notification to specific user or org
  socket.on("send-notification", (data: Omit<NotificationPayload, "id" | "timestamp">) => {
    const notification: NotificationPayload = {
      ...data,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    if (data.userId) {
      // Send to specific user
      io.to(`user:${data.userId}`).emit("notification", notification);
      console.log(`[NextMav Notifications] Sent notification to user ${data.userId}: ${data.title}`);
    } else if (data.organizationId) {
      // Broadcast to entire org
      io.to(`org:${data.organizationId}`).emit("notification", notification);
      console.log(`[NextMav Notifications] Broadcast to org ${data.organizationId}: ${data.title}`);
    }
  });

  // Broadcast activity event
  socket.on("activity-event", (data: { organizationId: string; eventType: string; description: string; userId?: string }) => {
    io.to(`org:${data.organizationId}`).emit("activity", {
      ...data,
      timestamp: new Date().toISOString(),
    });
  });

  // Typing indicator for comments
  socket.on("typing", (data: { organizationId: string; userId: string; userName: string; entityType: string; entityId: string }) => {
    socket.to(`org:${data.organizationId}`).emit("user-typing", data);
  });

  socket.on("stop-typing", (data: { organizationId: string; userId: string; entityType: string; entityId: string }) => {
    socket.to(`org:${data.organizationId}`).emit("user-stopped-typing", data);
  });

  // Heartbeat
  socket.on("ping", () => {
    socket.emit("pong", { timestamp: new Date().toISOString() });
  });

  socket.on("disconnect", () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      connectedUsers.delete(socket.id);
      const orgSet = organizationRooms.get(user.organizationId);
      if (orgSet) {
        orgSet.delete(socket.id);
        if (orgSet.size === 0) organizationRooms.delete(user.organizationId);
      }
      // Notify org of presence change
      io.to(`org:${user.organizationId}`).emit("presence-update", {
        onlineUsers: Array.from(connectedUsers.values())
          .filter((u) => u.organizationId === user.organizationId)
          .map((u) => ({ userId: u.userId })),
      });
      console.log(`[NextMav Notifications] User ${user.userId} disconnected. Total: ${connectedUsers.size}`);
    }
  });

  socket.on("error", (error: Error) => {
    console.error(`[NextMav Notifications] Socket error (${socket.id}):`, error);
  });
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[NextMav Notifications] WebSocket service running on port ${PORT}`);
  console.log(`[NextMav Notifications] Ready to accept connections`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`[NextMav Notifications] Received ${signal}, shutting down...`);
  io.close(() => {
    httpServer.close(() => {
      console.log("[NextMav Notifications] Server closed");
      process.exit(0);
    });
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
