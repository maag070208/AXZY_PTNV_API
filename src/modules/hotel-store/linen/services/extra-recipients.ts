import type { Prisma, PrismaClient } from "@prisma/client";
import type { NotificationPort } from "@modules/notifications";

type Db = PrismaClient | Prisma.TransactionClient;
export type Notifier = Pick<NotificationPort, "createManyNotifications">;

/** Supervisores asignados a la zona o a cualquiera de sus ancestros (el árbol de zonas sube por `parentId`). */
export const zoneSupervisorIds = async (db: Db, zoneId: string | null | undefined): Promise<string[]> => {
  if (!zoneId) return [];
  const zones = await db.hotelZone.findMany({ select: { id: true, parentId: true } });
  const parentOf = new Map(zones.map((z) => [z.id, z.parentId]));
  const chain: string[] = [];
  for (let z: string | null | undefined = zoneId; z && !chain.includes(z); z = parentOf.get(z)) chain.push(z);
  const rows = await db.hotelZoneSupervisor.findMany({ where: { zoneId: { in: chain } }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))];
};

/** Usuarios activos con alguno de los roles (principal o adicional). */
export const userIdsByRoles = async (db: Db, roles: string[]): Promise<string[]> => {
  const rows = await db.user.findMany({
    where: { active: true, OR: [{ role: { in: roles } }, { extraRoles: { some: { role: { in: roles } } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
};

/** Avisa a los usuarios; el aviso es secundario, así que un fallo nunca revierte la operación. */
export const notifyUsers = async (
  notifications: Notifier | undefined,
  userIds: string[],
  payload: { type: string; title: string; detail?: string },
  excludeUserId?: string
): Promise<void> => {
  if (!notifications) return;
  const targets = [...new Set(userIds)].filter((id) => id !== excludeUserId);
  if (targets.length === 0) return;
  try {
    await notifications.createManyNotifications(targets.map((userId) => ({ userId, ...payload })));
  } catch {
    // Silencioso a propósito.
  }
};
