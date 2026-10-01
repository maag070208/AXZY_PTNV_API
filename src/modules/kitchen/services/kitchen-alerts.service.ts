import type { PrismaClient } from "@prisma/client";
import { logger } from "@core/utils/logger";
import { broadcastToUser } from "@core/services/ably";
import { enqueueNotificationEmail } from "@core/services/email-queue";
import { systemLanguage, t, type Language } from "@core/i18n";
import { scopeOf } from "@core/permissions";
import type { KitchenStockService } from "./kitchen-stock.service";

const NOTIFICATION_TYPE = "KITCHEN_ALERTS";
const MANAGE_PERMISSION = "kitchen.manage";
const DAY_MS = 24 * 60 * 60 * 1000;

interface NotificationsPort {
  createManyNotifications(
    inputs: { userId: string; type: string; title: string; detail?: string | null }[]
  ): Promise<unknown>;
}

interface AlertCounts {
  low: number;
  over: number;
  expiring: number;
  expired: number;
}

/**
 * Revisión diaria del almacén de cocina: avisa (notificación + correo) a quien
 * tenga `kitchen.manage` solo si el resultado **cambió** respecto al último
 * aviso, igual que el auditor de inventario.
 */
export class KitchenAlertsService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly stock: KitchenStockService,
    private readonly notifications: NotificationsPort
  ) {}

  /** Revisa al arrancar (con un minuto de margen) y luego cada 24 h. */
  startDailyCheck(): void {
    if (this.timer) return;
    const tick = () => void this.checkAndAlert().catch((err) => logger.error(`[kitchen-alerts] ${String(err)}`));
    setTimeout(tick, 60_000).unref();
    this.timer = setInterval(tick, DAY_MS);
    this.timer.unref();
  }

  async checkAndAlert(): Promise<AlertCounts> {
    const { counts } = await this.stock.alerts();
    const ok = counts.low + counts.over + counts.expiring + counts.expired === 0;
    const lng = await systemLanguage();
    const detail = this.summary(counts, ok, lng);
    const last = await this.db.notification.findFirst({
      where: { type: NOTIFICATION_TYPE },
      orderBy: { createdAt: "desc" },
      select: { detail: true },
    });
    const changed = ok ? !!last && last.detail !== detail : last?.detail !== detail;
    if (!changed) return counts;

    const title = t(ok ? "kitchenAlerts.resolvedTitle" : "kitchenAlerts.alertTitle", {}, lng);
    logger[ok ? "info" : "warn"](`[kitchen-alerts] ${title}: ${detail}`);

    const recipients = await this.recipients();
    if (recipients.length > 0) {
      await this.notifications.createManyNotifications(
        recipients.map((userId) => ({ userId, type: NOTIFICATION_TYPE, title, detail }))
      );
      for (const userId of recipients) {
        broadcastToUser(userId, {
          type: NOTIFICATION_TYPE,
          title,
          detail,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }
    if (!ok) {
      await enqueueNotificationEmail({
        subject: `[Puerto Nuevo] ${title}`,
        html: this.emailHtml(counts, lng),
        action: MANAGE_PERMISSION,
        entityType: "Kitchen",
      });
    }
    return counts;
  }

  /** Resumen estable de una línea (también sirve de firma del último aviso). */
  private summary(counts: AlertCounts, ok: boolean, lng: Language): string {
    if (ok) return t("kitchenAlerts.ok", {}, lng);
    return (
      [
        ["low", counts.low],
        ["over", counts.over],
        ["expiring", counts.expiring],
        ["expired", counts.expired],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${t(`kitchenAlerts.${key}`, {}, lng)}: ${n}`)
      .join(" · ");
  }

  private emailHtml(counts: AlertCounts, lng: Language): string {
    const lines = (
      [
        ["low", counts.low],
        ["over", counts.over],
        ["expiring", counts.expiring],
        ["expired", counts.expired],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `<li>${t(`kitchenAlerts.${key}`, {}, lng)}: <strong>${n}</strong></li>`)
      .join("");
    return `<p>${t("kitchenAlerts.emailIntro", {}, lng)}</p><ul>${lines}</ul>`;
  }

  /** Usuarios activos cuyo rol tiene `kitchen.manage`. */
  private async recipients(): Promise<string[]> {
    const users = await this.db.user.findMany({
      where: { active: true },
      select: { id: true, role: true, extraRoles: { select: { role: true } } },
    });
    return users
      .filter(
        (u) =>
          scopeOf(
            { id: u.id, role: u.role, roles: [u.role, ...u.extraRoles.map((r) => r.role)] },
            MANAGE_PERMISSION
          ) !== "NONE"
      )
      .map((u) => u.id);
  }
}
