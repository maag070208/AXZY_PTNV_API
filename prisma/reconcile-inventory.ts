/**
 * Concilia el inventario heredado del respaldo con el modelo nuevo, de forma
 * DURABLE e idempotente.
 *
 * Uso:  npm run inventory:reconcile
 *
 * Qué corrige y por qué:
 *  - LEDGER_MISMATCH: el respaldo convirtió salidas viejas (`SALIDA`) en
 *    `ADJUSTMENT_OUT`, que restan del kardex, pero la unidad física seguía
 *    `AVAILABLE`: hay más disponibles que kardex. La verdad operativa son las
 *    unidades físicas, así que se sube el KARDEX con un `ADJUSTMENT_IN` (una
 *    entrada de ajuste) que liga las MISMAS piezas, sin crear ni dar de baja
 *    unidades. Si el kardex va por delante de lo disponible no se inventa nada:
 *    se reporta como `unresolved` para conteo manual.
 *  - MOVEMENT_UNITS_MISMATCH de un `LOAN`: el renglón del préstamo no tiene
 *    ligadas sus unidades. Se ligan las `loan_item_units` abiertas del mismo
 *    dispositivo (orden por activo fijo) hasta cubrir la cantidad.
 *
 * Es idempotente (una segunda corrida no cambia nada) y usa
 * `Movement.requestId = "reconcile-ledger:<deviceId>"` (único) para blindar
 * dobles corridas concurrentes. Se ejecuta también desde `seed.ts`, así que
 * `cutover` / `FORCE_RESET` dejan la base cuadrada.
 */
import { Prisma, PrismaClient } from "@prisma/client";
// Carga api/.env (DATABASE_URL, …) — como hace `prisma db seed`.
import "dotenv/config";
// Imports RELATIVOS a propósito: el seed corre `ts-node` sin `tsconfig-paths`.
import { ledgerDelta } from "../src/modules/inventory/services/ledger";
import { LANGUAGE_CONFIG_KEY, setSystemLanguageReader, systemLanguage, t } from "../src/core/i18n";

export interface LedgerAdjustment {
  deviceId: string;
  device: string;
  ledger: number;
  available: number;
  diff: number;
  movementId: string;
}

export interface LinkedUnits {
  movementId: string;
  movementItemId: string;
  movementType: string;
  deviceId: string;
  linked: string[];
}

export interface Unresolved {
  kind: "LEDGER_AHEAD" | "MOVEMENT_UNITS";
  detail: string;
  deviceId?: string;
  device?: string;
  ledger?: number;
  available?: number;
  movementItemId?: string;
  movementType?: string;
}

export interface ReconcileReport {
  adjusted: LedgerAdjustment[];
  linkedUnits: LinkedUnits[];
  unresolved: Unresolved[];
  /** `true` si tras la corrida no queda ningún descuadre sin resolver. */
  balanced: boolean;
}

/** Se niega a tocar una base que no sea local (igual que `mock:access`). */
/**
 * La conciliación ESCRIBE en el inventario, así que por defecto solo corre
 * contra una base local: así un `npm run inventory:reconcile` distraído no toca
 * la base de un cliente. En el servidor del cliente la base es el servicio
 * `postgres` del compose (no `localhost`), así que ahí se permite a propósito
 * con `INVENTORY_RECONCILE_REMOTE=1` — es una decisión consciente y de una vez.
 */
function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  const allowed = process.env.INVENTORY_RECONCILE_REMOTE === "1" || !!process.env.E2E_ALLOW_REMOTE_DB;
  if (!isLocal && !allowed) {
    throw new Error(
      `inventory:reconcile solo corre contra una base local (DATABASE_URL=${url}). ` +
        `Si es la base del cliente y es a propósito: INVENTORY_RECONCILE_REMOTE=1`
    );
  }
}

/** Autor de respaldo si el movimiento origen no tiene uno utilizable. */
async function fallbackAdminId(db: PrismaClient): Promise<string | null> {
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/**
 * Un `P2002` significa que otra corrida ya insertó el ajuste (el `requestId`
 * es único): no es un error, simplemente esta corrida no hace nada.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Kardex por dispositivo: suma de `ledgerDelta` de todos sus renglones. */
async function ledgerByDevice(db: PrismaClient): Promise<Map<string, number>> {
  const items = await db.movementItem.findMany({
    select: {
      deviceId: true,
      quantity: true,
      condition: true,
      movement: { select: { type: true, reversalOf: { select: { type: true } } } },
    },
  });
  const ledger = new Map<string, number>();
  for (const item of items) {
    const delta = ledgerDelta(
      item.movement.type,
      item.quantity,
      item.condition,
      item.movement.reversalOf?.type
    );
    ledger.set(item.deviceId, (ledger.get(item.deviceId) ?? 0) + delta);
  }
  return ledger;
}

/**
 * Selecciona exactamente `diff` unidades `AVAILABLE` de forma determinista:
 * primero las ya ligadas a un `ADJUSTMENT_OUT` (la huella de la salida vieja),
 * luego las que no tienen ningún movimiento, después el resto; desempate por
 * activo fijo.
 */
async function pickUnits(db: PrismaClient, deviceId: string, diff: number) {
  const units = await db.deviceUnit.findMany({
    where: { deviceId, status: "AVAILABLE" },
    select: {
      id: true,
      assetTag: true,
      movementItemUnits: {
        select: { item: { select: { movement: { select: { type: true } } } } },
      },
    },
  });

  const priority = (unit: (typeof units)[number]): number => {
    if (unit.movementItemUnits.some((m) => m.item.movement.type === "ADJUSTMENT_OUT")) return 0;
    if (unit.movementItemUnits.length === 0) return 1;
    return 2;
  };

  return units
    .sort((a, b) => priority(a) - priority(b) || a.assetTag.localeCompare(b.assetTag))
    .slice(0, diff);
}

/** Crea el `ADJUSTMENT_IN` que sube el kardex al nivel de lo disponible. */
async function applyLedgerAdjustment(
  db: PrismaClient,
  device: { id: string; name: string },
  ledger: number,
  available: number,
  diff: number
): Promise<LedgerAdjustment | null> {
  const requestId = `reconcile-ledger:${device.id}`;
  const already = await db.movement.findUnique({ where: { requestId }, select: { id: true } });
  if (already) return null;

  const units = await pickUnits(db, device.id, diff);
  if (units.length < diff) {
    return null;
  }

  // Fecha y autor del `ADJUSTMENT_OUT` más antiguo del dispositivo (históricos),
  // con respaldo al primer ADMIN activo.
  const origin = await db.movementItem.findFirst({
    where: { deviceId: device.id, movement: { type: "ADJUSTMENT_OUT" } },
    orderBy: [{ movement: { date: "asc" } }, { movementId: "asc" }],
    select: { movement: { select: { date: true, createdById: true } } },
  });
  const date = origin?.movement.date ?? new Date();
  const createdById = origin?.movement.createdById ?? (await fallbackAdminId(db));
  if (!createdById) return null;

  let movementId: string;
  try {
    const movement = await db.movement.create({
      data: {
        type: "ADJUSTMENT_IN",
        status: "ACTIVE",
        date,
        createdById,
        reason: t("inventory.reconcileReason", {}, await systemLanguage()),
        requestId,
        items: {
          create: [
            {
              deviceId: device.id,
              quantity: diff,
              condition: null,
              units: { create: units.map((u) => ({ deviceUnitId: u.id })) },
            },
          ],
        },
      },
      select: { id: true },
    });
    movementId = movement.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  await db.auditLog.create({
    data: {
      action: "MOVEMENT_ADJUSTMENT_IN",
      entityType: "Movement",
      entityId: movementId,
      userId: createdById,
      deviceId: device.id,
      metadata: {
        device: device.name,
        ledger,
        available,
        diff,
        unitIds: units.map((u) => u.id),
        source: "inventory-reconcile",
      },
    },
  });

  return { deviceId: device.id, device: device.name, ledger, available, diff, movementId };
}

/**
 * Liga al renglón de un `LOAN` las `loan_item_units` abiertas del mismo
 * dispositivo que aún no estén ligadas, hasta cubrir su cantidad.
 */
async function linkLoanItemUnits(
  db: PrismaClient,
  item: {
    id: string;
    movementId: string;
    deviceId: string;
    quantity: number;
    units: number;
    movementType: string;
  }
): Promise<LinkedUnits | null> {
  const needed = item.quantity - item.units;
  if (needed <= 0) return null;

  const loan = await db.loan.findFirst({
    where: { movementId: item.movementId },
    select: { id: true },
  });
  if (!loan) return null;

  const existing = await db.movementItemUnit.findMany({
    where: { movementItemId: item.id },
    select: { deviceUnitId: true },
  });
  const linked = new Set(existing.map((e) => e.deviceUnitId));

  const candidates = await db.loanItemUnit.findMany({
    where: {
      returned: false,
      loanItem: { loanId: loan.id, deviceId: item.deviceId },
      deviceUnit: { deviceId: item.deviceId },
    },
    orderBy: { deviceUnit: { assetTag: "asc" } },
    select: { deviceUnitId: true },
  });

  const toLink = candidates
    .map((c) => c.deviceUnitId)
    .filter((id) => !linked.has(id))
    .slice(0, needed);
  if (toLink.length === 0) return null;

  await db.movementItemUnit.createMany({
    data: toLink.map((deviceUnitId) => ({ movementItemId: item.id, deviceUnitId })),
    skipDuplicates: true,
  });

  return {
    movementId: item.movementId,
    movementItemId: item.id,
    movementType: item.movementType,
    deviceId: item.deviceId,
    linked: toLink,
  };
}

/**
 * Liga las unidades de los movimientos de ENTRADA que se quedaron sin registrar
 * sus piezas: el respaldo del cliente trae renglones `STOCK_IN` con su cantidad
 * pero SIN ningún renglón en `movement_item_units` (los creó una versión que
 * todavía no ligaba las unidades del alta).
 *
 * Regla (determinista, sin inventar piezas): por dispositivo se recorren sus
 * altas en orden cronológico y a cada una se le asignan las unidades en orden de
 * creación (activo fijo), que es el orden en el que se dieron de alta. Las
 * unidades que ya están ligadas a ESE renglón no se tocan, y las que están
 * ligadas a otro movimiento (p. ej. un préstamo) también cuentan para el alta:
 * una pieza puede aparecer en su alta y en su préstamo a la vez.
 *
 * Si al dispositivo no le alcanzan las unidades para cubrir sus altas, no se
 * inventa nada: se reporta como `unresolved` para conteo manual.
 */
async function linkEntryUnits(db: PrismaClient): Promise<{
  linked: LinkedUnits[];
  unresolved: Unresolved[];
}> {
  const linked: LinkedUnits[] = [];
  const unresolved: Unresolved[] = [];

  const items = await db.movementItem.findMany({
    where: {
      movement: { type: { in: ["STOCK_IN", "ADJUSTMENT_IN"] }, status: "ACTIVE" },
    },
    select: {
      id: true,
      movementId: true,
      deviceId: true,
      quantity: true,
      movement: { select: { type: true, date: true, requestId: true } },
      units: { select: { deviceUnitId: true } },
    },
  });

  // Los ajustes del propio reconciliador ya ligan sus unidades al crearse.
  const pending = items.filter(
    (item) => item.movement.requestId === null && item.units.length !== item.quantity
  );
  if (pending.length === 0) return { linked, unresolved };

  const byDevice = new Map<string, typeof pending>();
  for (const item of pending) {
    byDevice.set(item.deviceId, [...(byDevice.get(item.deviceId) ?? []), item]);
  }

  for (const [deviceId, deviceItems] of byDevice) {
    const units = await db.deviceUnit.findMany({
      where: { deviceId },
      orderBy: [{ createdAt: "asc" }, { assetTag: "asc" }],
      select: { id: true, assetTag: true },
    });

    // Cursor sobre la lista de unidades: se consume en orden de creación, así el
    // alta más antigua se queda con las primeras piezas.
    let cursor = 0;
    const ordered = [...deviceItems].sort(
      (a, b) =>
        a.movement.date.getTime() - b.movement.date.getTime() ||
        a.movementId.localeCompare(b.movementId)
    );

    for (const item of ordered) {
      const already = new Set(item.units.map((u) => u.deviceUnitId));
      const missing = item.quantity - already.size;
      const take: string[] = [];
      while (take.length < missing && cursor < units.length) {
        const unit = units[cursor++];
        if (already.has(unit.id)) continue;
        take.push(unit.id);
      }

      if (take.length < missing) {
        unresolved.push({
          kind: "MOVEMENT_UNITS",
          movementItemId: item.id,
          movementType: item.movement.type,
          deviceId,
          detail: `movement item ${item.id} (${item.movement.type}) has ${already.size + take.length}/${item.quantity} units and the device only has ${units.length}`,
        });
        continue;
      }

      await db.movementItemUnit.createMany({
        data: take.map((deviceUnitId) => ({ movementItemId: item.id, deviceUnitId })),
        skipDuplicates: true,
      });
      linked.push({
        movementId: item.movementId,
        movementItemId: item.id,
        movementType: item.movement.type,
        deviceId,
        linked: take,
      });
    }
  }

  return { linked, unresolved };
}

/** Corre las dos fases y devuelve el reporte. Idempotente. */
export async function reconcileInventory(db: PrismaClient): Promise<ReconcileReport> {
  const report: ReconcileReport = { adjusted: [], linkedUnits: [], unresolved: [], balanced: false };

  // --- Fase kardex ---------------------------------------------------------
  const ledger = await ledgerByDevice(db);
  const availableGroups = await db.deviceUnit.groupBy({
    by: ["deviceId"],
    where: { status: "AVAILABLE" },
    _count: { _all: true },
  });
  const available = new Map(availableGroups.map((g) => [g.deviceId, g._count._all]));
  const devices = await db.device.findMany({ select: { id: true, name: true } });

  for (const device of devices) {
    const led = ledger.get(device.id) ?? 0;
    const avail = available.get(device.id) ?? 0;
    if (avail > led) {
      const adjustment = await applyLedgerAdjustment(db, device, led, avail, avail - led);
      if (adjustment) report.adjusted.push(adjustment);
    } else if (avail < led) {
      report.unresolved.push({
        kind: "LEDGER_AHEAD",
        deviceId: device.id,
        device: device.name,
        ledger: led,
        available: avail,
        detail: `available ${avail} < ledger ${led} for device ${device.id}`,
      });
    }
  }

  // --- Fase unidades -------------------------------------------------------
  // Primero las altas (es la pieza que el respaldo del cliente trae suelta) y
  // después los préstamos, que sí se pueden resolver con `loan_item_units`.
  const entries = await linkEntryUnits(db);
  report.linkedUnits.push(...entries.linked);
  report.unresolved.push(...entries.unresolved);

  const items = await db.movementItem.findMany({
    select: {
      id: true,
      movementId: true,
      deviceId: true,
      quantity: true,
      movement: { select: { type: true } },
      _count: { select: { units: true } },
    },
  });

  for (const item of items) {
    if (item.quantity === item._count.units) continue;
    // Las altas ya se resolvieron arriba (y si no alcanzaron las unidades, ya
    // quedaron reportadas): aquí solo faltan los préstamos.
    if (item.movement.type === "STOCK_IN" || item.movement.type === "ADJUSTMENT_IN") continue;
    const info = {
      id: item.id,
      movementId: item.movementId,
      deviceId: item.deviceId,
      quantity: item.quantity,
      units: item._count.units,
      movementType: item.movement.type,
    };
    const linked = item.movement.type === "LOAN" ? await linkLoanItemUnits(db, info) : null;
    if (linked) {
      report.linkedUnits.push(linked);
    } else {
      report.unresolved.push({
        kind: "MOVEMENT_UNITS",
        movementItemId: item.id,
        movementType: item.movement.type,
        deviceId: item.deviceId,
        detail: `movement item ${item.id} (${item.movement.type}) has ${item._count.units}/${item.quantity} units`,
      });
    }
  }

  report.balanced = report.unresolved.length === 0;
  return report;
}

function printReport(report: ReconcileReport): void {
  console.log(
    `[inventory:reconcile] kardex ajustados: ${report.adjusted.length}, ` +
      `renglones con unidades ligadas: ${report.linkedUnits.length}, ` +
      `sin resolver: ${report.unresolved.length}`
  );
  for (const a of report.adjusted) {
    console.log(`  + ${a.device} (kardex ${a.ledger} → ${a.available}, diff ${a.diff}) · ${a.movementId}`);
  }
  for (const l of report.linkedUnits) {
    console.log(`  link ${l.movementType} ${l.movementId} → ${l.linked.length} unidad(es)`);
  }
  for (const u of report.unresolved) {
    console.warn(`  ! [${u.kind}] ${u.detail}`);
  }
  console.log(`[inventory:reconcile] ${report.balanced ? "OK · inventario cuadrado" : "PENDIENTE · revisar avisos"}`);
}

async function main() {
  assertLocalDatabase();
  // Cliente propio solo al ejecutar el script: importar `reconcileInventory`
  // desde `seed.ts` no debe abrir una conexión extra.
  const prisma = new PrismaClient();
  // El script corre fuera de una petición: el idioma del motivo sale de
  // `sys_config.LANGUAGE` (con fallback a `es`).
  setSystemLanguageReader(async () => {
    const config = await prisma.sysConfig.findUnique({ where: { key: LANGUAGE_CONFIG_KEY } });
    return config?.value ?? null;
  });

  const report = await reconcileInventory(prisma);
  printReport(report);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[inventory:reconcile] error:", err);
    process.exit(1);
  });
}
