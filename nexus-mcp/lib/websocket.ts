/**
 * WebSocket server for real-time dashboard updates.
 * Broadcasts debate events to all connected dashboard clients.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("📡 Dashboard client connected");
    ws.send(JSON.stringify({ type: "connected", message: "NEXUS WebSocket connected" }));

    ws.on("close", () => {
      console.log("📡 Dashboard client disconnected");
    });
  });

  console.log("📡 WebSocket server ready on /ws");
}

/**
 * Broadcast an event to all connected dashboard clients.
 */
export function broadcast(event: {
  type: string;
  session_id: string;
  [key: string]: any;
}): void {
  if (!wss) return;

  const payload = JSON.stringify({ ...event, timestamp: new Date().toISOString() });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}
