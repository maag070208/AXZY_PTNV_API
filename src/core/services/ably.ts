import Ably from "ably";
import { env } from "@core/config/env.config";

let ably: Ably.Realtime | null = null;

export const getAbly = (): Ably.Realtime => {
  if (!ably) {
    ably = new Ably.Realtime({ key: env.ABLY_API_KEY });
  }
  return ably;
};

export interface TicketEvent {
  type: "COMMENT" | "STATUS" | "ASSIGNED" | "UPDATED" | "CREATED" | "DELETED";
  ticketId: string;
  data: Record<string, unknown>;
}

export const broadcastTicketEvent = async (event: TicketEvent) => {
  const client = getAbly();
  const channel = client.channels.get(`tickets:${event.ticketId}`);
  await channel.publish(event.type, event.data);
};

export const broadcastToUser = async (userId: string, event: Record<string, unknown>) => {
  const client = getAbly();
  const channel = client.channels.get(`user:${userId}`);
  await channel.publish("NOTIFICATION", event);
};

export interface DashboardEvent {
  scope: "devices" | "tickets" | "cartas" | "salidas" | "inventory";
  message: string;
}

// Canal único para el dashboard administrativo: cada mutación relevante
// publica un mensaje corto ya formateado; el frontend lo usa tanto para
// refrescar sus KPIs (debounced) como para el feed de actividad en vivo.
export const broadcastDashboardEvent = async (event: DashboardEvent) => {
  const client = getAbly();
  const channel = client.channels.get("dashboard");
  await channel.publish("UPDATE", { ...event, at: new Date().toISOString() });
};
