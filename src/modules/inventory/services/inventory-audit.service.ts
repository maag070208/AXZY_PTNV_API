import { Prisma, type PrismaClient } from "@prisma/client";
import { logger } from "@core/utils/logger";
import { broadcastToUser } from "@core/services/ably";
import { enqueueNotificationEmail } from "@core/services/email-queue";
import { label, systemLanguage, t, type Language } from "@core/i18n";
import { scopeOf } from "@core/permissions";
import { ledgerDelta } from "./ledger";

/**
 * Auditor del inventario: revisa que préstamos, unidades y kardex cuadren.
 * Cada regla devuelve cuántos casos la rompen y algunos ejemplos (activo
 * fijo, folio o dispositivo) para ir directo a corregirlos. Con todo en cero
 * el inventario está consistente.
 */
export const AUDIT_CHECKS = [
  "UNIT_IN_MULTIPLE_OPEN_LOANS",
  "LOAN_ITEM_PENDING_MISMATCH",
  "OPEN_LOAN_UNIT_NOT_ON_LOAN",
  "ON_LOAN_UNIT_WITHOUT_LOAN",
  "CLOSED_LOAN_WITH_OPEN_UNITS",
  "LOAN_STATUS_MISMATCH",
  "MOVEMENT_UNITS_MISMATCH",
  "LEDGER_MISMATCH",
] as const;
export type AuditCheckKey = (typeof AUDIT_CHECKS)[number];

export interface AuditRow {
  /** Renglón (`movement_items.id`), para resolverlo desde la pantalla. */
  movementItemId?: string;
  /** Tipo de movimiento YA traducido (`label("movementType", …)`), nunca el enum crudo. */
  movementType?: string;
  /** Día del movimiento (`YYYY-MM-DD`). */
  date?: string;
  device?: string;
  /** Lo que declara el renglón y las piezas que tiene ligadas. */
  quantity?: number;
  linked?: number;
}

export interface AuditCheckResult {
  key: AuditCheckKey;
  count: number;
  /** Hasta 10 ejemplos legibles de los casos que rompen la regla. */
  samples: string[];
  /** El mismo detalle, en piezas, cuando la regla lo conoce (hoy la de movimientos). */
  rows?: AuditRow[];
}

export interface InventoryAuditResult {
  ok: boolean;
  checkedAt: string;
  checks: AuditCheckResult[];
}

const AUDIT_PERMISSION = "inventory.audit";
const NOTIFICATION_TYPE = "INVENTORY_AUDIT";
const SAMPLE_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Cada regla SQL devuelve un renglón por caso, con su ejemplo legible en `sample`.
type Row = { sample: string };

export class InventoryAuditService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly notifications: {
      createManyNotifications(inputs: { userId: string; type: string; title: string; detail?: string | null }[]): Promise<unknown>;
    }
  ) {}

  async run(): Promise<InventoryAuditResult> {
    const sql = async (query: Prisma.Sql) => (await this.db.$queryRaw<Row[]>(query)).map((r) => r.sample);
    const raw = Prisma.sql;
    const lng = await systemLanguage();

    // La regla de movimientos se lee en piezas (no como texto armado en SQL):
    // así la web pinta el detalle y el tipo sale del i18n, no de la base.
    const desviados = await this.db.$queryRaw<
      { movementItemId: string; type: string; date: string; device: string; quantity: number; linked: number }[]
    >(raw`
      SELECT mi.id AS "movementItemId", m.type::text AS type, to_char(m.date, 'YYYY-MM-DD') AS date, d.name AS device,
             mi.quantity AS quantity,
             (SELECT count(*) FROM movement_item_units x WHERE x."movementItemId" = mi.id)::int AS linked
      FROM movement_items mi JOIN movements m ON m.id = mi."movementId" JOIN devices d ON d.id = mi."deviceId"
      WHERE mi.quantity <> (SELECT count(*) FROM movement_item_units x WHERE x."movementItemId" = mi.id)
      ORDER BY m.date, d.name`);
    const filasMovimiento: AuditRow[] = desviados.map((m) => ({
      movementItemId: m.movementItemId,
      movementType: label("movementType", m.type, lng),
      date: m.date,
      device: m.device,
      quantity: m.quantity,
      linked: m.linked,
    }));

    const results: Record<AuditCheckKey, string[]> = {
      UNIT_IN_MULTIPLE_OPEN_LOANS: await sql(raw`
        SELECT du."assetTag" AS sample FROM loan_item_units u
        JOIN device_units du ON du.id = u."deviceUnitId"
        WHERE NOT u.returned GROUP BY du."assetTag" HAVING count(*) > 1 ORDER BY 1`),
      LOAN_ITEM_PENDING_MISMATCH: await sql(raw`
        SELECT l.number AS sample FROM loan_items li JOIN loans l ON l.id = li."loanId"
        WHERE li.quantity - li."returnedQuantity" <>
          (SELECT count(*) FROM loan_item_units u WHERE u."loanItemId" = li.id AND NOT u.returned)
        ORDER BY 1`),
      OPEN_LOAN_UNIT_NOT_ON_LOAN: await sql(raw`
        SELECT du."assetTag" || ' (' || du.status || ', ' || l.number || ')' AS sample
        FROM loan_item_units u JOIN device_units du ON du.id = u."deviceUnitId"
        JOIN loan_items li ON li.id = u."loanItemId" JOIN loans l ON l.id = li."loanId"
        WHERE NOT u.returned AND du.status <> 'ON_LOAN' ORDER BY 1`),
      ON_LOAN_UNIT_WITHOUT_LOAN: await sql(raw`
        SELECT d."assetTag" AS sample FROM device_units d
        WHERE d.status = 'ON_LOAN'
          AND NOT EXISTS (SELECT 1 FROM loan_item_units u WHERE u."deviceUnitId" = d.id AND NOT u.returned)
        ORDER BY 1`),
      CLOSED_LOAN_WITH_OPEN_UNITS: await sql(raw`
        SELECT DISTINCT l.number AS sample FROM loan_item_units u
        JOIN loan_items li ON li.id = u."loanItemId" JOIN loans l ON l.id = li."loanId"
        WHERE NOT u.returned AND l.status IN ('RETURNED', 'CANCELLED') ORDER BY 1`),
      LOAN_STATUS_MISMATCH: await sql(raw`
        SELECT l.number || ' (' || l.status || ')' AS sample FROM loans l
        WHERE l.status <> 'CANCELLED' AND l.status::text <> (
          CASE
            WHEN NOT EXISTS (SELECT 1 FROM loan_items li WHERE li."loanId" = l.id AND li."returnedQuantity" < li.quantity) THEN 'RETURNED'
            WHEN EXISTS (SELECT 1 FROM loan_items li WHERE li."loanId" = l.id AND li."returnedQuantity" > 0) THEN 'PARTIAL'
            ELSE 'ACTIVE'
          END)
        ORDER BY 1`),
      MOVEMENT_UNITS_MISMATCH: filasMovimiento.map(
        (m) => `${m.movementType} ${m.date} · ${m.device}`
      ),
      LEDGER_MISMATCH: await this.ledgerMismatches(lng),
    };

    const checks = AUDIT_CHECKS.map((key) => ({
      key,
      count: results[key].length,
      samples: results[key].slice(0, SAMPLE_LIMIT),
      ...(key === "MOVEMENT_UNITS_MISMATCH" ? { rows: filasMovimiento.slice(0, SAMPLE_LIMIT) } : {}),
    }));
    return { ok: checks.every((c) => c.count === 0), checkedAt: new Date().toISOString(), checks };
  }

  /**
   * Resuelve un renglón descuadrado del auditor. `link` liga las piezas que
   * existan (mismo criterio del conciliador: orden de creación / activo fijo);
   * `quantity` liga lo que haya y deja la cantidad en lo ligado —MUEVE el kardex,
   * el admin lo confirma a propósito—; `review` no toca nada (queda constancia
   * de quién lo revisó en la bitácora).
   */
  async resolveMismatch(
    movementItemId: string,
    mode: "link" | "quantity" | "review"
  ): Promise<{ movementItemId: string; linked: number; remaining: number; quantity: number }> {
    return this.db.$transaction(
      async (tx) => {
        const item = await tx.movementItem.findUnique({
          where: { id: movementItemId },
          select: {
            id: true,
            deviceId: true,
            quantity: true,
            units: { select: { deviceUnitId: true } },
          },
        });
        if (!item) return { movementItemId, linked: 0, remaining: 0, quantity: 0 };

        const ya = item.units.map((u) => u.deviceUnitId);
        const faltan = item.quantity - ya.length;
        let ligadas = 0;
        if (faltan > 0 && mode !== "review") {
          const candidatas = await tx.deviceUnit.findMany({
            where: { deviceId: item.deviceId, id: { notIn: ya } },
            orderBy: [{ createdAt: "asc" }, { assetTag: "asc" }],
            take: faltan,
            select: { id: true },
          });
          if (candidatas.length > 0) {
            await tx.movementItemUnit.createMany({
              data: candidatas.map((u) => ({ movementItemId: item.id, deviceUnitId: u.id })),
              skipDuplicates: true,
            });
            ligadas = candidatas.length;
          }
        }

        const total = ya.length + ligadas;
        if (mode === "quantity" && total !== item.quantity) {
          await tx.movementItem.update({ where: { id: item.id }, data: { quantity: total } });
        }
        return {
          movementItemId: item.id,
          linked: ligadas,
          remaining: Math.max(0, item.quantity - total),
          quantity: mode === "quantity" ? total : item.quantity,
        };
      },
      { isolationLevel: "Serializable" }
    );
  }

  /** Kardex (suma de `ledgerDelta`) contra unidades DISPONIBLES, por dispositivo. */
  private async ledgerMismatches(lng: Language): Promise<string[]> {
    const [items, units, devices] = await Promise.all([
      this.db.movementItem.findMany({
        select: {
          deviceId: true,
          quantity: true,
          condition: true,
          movement: { select: { type: true, reversalOf: { select: { type: true } } } },
        },
      }),
      this.db.deviceUnit.groupBy({ by: ["deviceId"], where: { status: "AVAILABLE" }, _count: { _all: true } }),
      this.db.device.findMany({ select: { id: true, name: true } }),
    ]);
    const ledger = new Map<string, number>();
    for (const i of items) {
      const delta = ledgerDelta(i.movement.type, i.quantity, i.condition, i.movement.reversalOf?.type);
      ledger.set(i.deviceId, (ledger.get(i.deviceId) ?? 0) + delta);
    }
    const available = new Map(units.map((u) => [u.deviceId, u._count._all]));
    return devices
      .filter((d) => (ledger.get(d.id) ?? 0) !== (available.get(d.id) ?? 0))
      .map((d) =>
        t("inventoryAudit.ledgerSample", { device: d.name, ledger: ledger.get(d.id) ?? 0, available: available.get(d.id) ?? 0 }, lng)
      )
      .sort();
  }

  // --- revisión diaria y avisos ---------------------------------------------------

  /** Revisa al arrancar (con un minuto de margen) y luego cada 24 h. */
  startDailyCheck(): void {
    if (this.timer) return;
    const tick = () => void this.checkAndAlert().catch((err) => logger.error(`[inventory-audit] ${String(err)}`));
    setTimeout(tick, 60_000).unref();
    this.timer = setInterval(tick, DAY_MS);
    this.timer.unref();
  }

  /**
   * Corre la auditoría y avisa (notificación en la app a quien tenga
   * `inventory.audit` y correo a los destinatarios de notificaciones) solo si
   * el resultado cambió respecto al último aviso: un descuadre nuevo o
   * distinto, o que ya se resolvió. El último aviso es la memoria: no se
   * repite el mismo todos los días.
   */
  async checkAndAlert(): Promise<InventoryAuditResult> {
    const result = await this.run();
    const lng = await systemLanguage();
    const detail = this.summary(result, lng);
    const last = await this.db.notification.findFirst({
      where: { type: NOTIFICATION_TYPE },
      orderBy: { createdAt: "desc" },
      select: { detail: true },
    });
    const changed = result.ok ? !!last && last.detail !== detail : last?.detail !== detail;
    if (!changed) return result;

    const title = t(result.ok ? "inventoryAudit.resolvedTitle" : "inventoryAudit.alertTitle", {}, lng);
    logger[result.ok ? "info" : "warn"](`[inventory-audit] ${title}: ${detail}`);
    const recipients = await this.recipients();
    if (recipients.length > 0) {
      await this.notifications.createManyNotifications(
        recipients.map((userId) => ({ userId, type: NOTIFICATION_TYPE, title, detail }))
      );
      for (const userId of recipients) {
        broadcastToUser(userId, { type: NOTIFICATION_TYPE, title, detail, createdAt: new Date().toISOString() }).catch(() => {});
      }
    }
    if (!result.ok) {
      await enqueueNotificationEmail({
        subject: `[Puerto Nuevo] ${title}`,
        html: this.emailHtml(result, lng),
        action: "inventory.audit",
        entityType: "Inventory",
      });
    }
    return result;
  }

  /** Resumen estable de una línea (también sirve de firma del último aviso). */
  private summary(result: InventoryAuditResult, lng: Language): string {
    if (result.ok) return t("inventoryAudit.ok", {}, lng);
    return result.checks
      .filter((c) => c.count > 0)
      .map((c) => `${t(`inventoryAudit.checks.${c.key}`, {}, lng)}: ${c.count}`)
      .join(" · ");
  }

  private emailHtml(result: InventoryAuditResult, lng: Language): string {
    const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const items = result.checks
      .filter((c) => c.count > 0)
      .map(
        (c) =>
          `<li><strong>${escape(t(`inventoryAudit.checks.${c.key}`, {}, lng))}: ${c.count}</strong><br/>${c.samples.map(escape).join(", ")}</li>`
      )
      .join("");
    return `<p>${escape(t("inventoryAudit.emailIntro", {}, lng))}</p><ul>${items}</ul>`;
  }

  /** Usuarios activos cuyo rol tiene `inventory.audit`. */
  private async recipients(): Promise<string[]> {
    const users = await this.db.user.findMany({ where: { active: true }, select: { id: true, role: true } });
    return users.filter((u) => scopeOf({ id: u.id, role: u.role }, AUDIT_PERMISSION) !== "NONE").map((u) => u.id);
  }
}
