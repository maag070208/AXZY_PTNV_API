import bcrypt from "bcryptjs";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { test, expect, contextAuthenticated } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";
import { DEFAULT_LOCATIONS } from "../../src/modules/hotel-store/services/warehouse.service";

/**
 * E2E de contrato — Blancos: pedido de la habitación al desocuparse.
 *
 * Recorre el flujo REAL de producción, todo por HTTP contra la API levantada:
 * check-out de la habitación (la supervisora) → el servidor crea solo el pedido
 * `ROOM_TURNOVER` con la dotación (`HotelRoomPar` × camas/baños) y la tarea de
 * limpieza `CHECKOUT` → extras → surtido (lavandería, traspaso IN_TRANSIT) →
 * recogido (auxiliar de piso) → entregado (misma auxiliar) → diferencia
 * (supervisora, ajuste ADJUST_OUT) → verificación final "quién/dónde/cuándo" y
 * notificaciones, con idempotencia al repetir el check-out.
 *
 * Aislamiento: TODO lo que crea esta corrida lleva el sufijo `E2E_LINEN_<RUN>`
 * en códigos/nombres y se borra en `afterAll` aunque el test falle. La dotación
 * esperada usa TODOS los `HotelRoomPar` LINEN de la base (los del cliente
 * también), así que el pedido puede traer renglones de otros productos: el test
 * localiza el suyo y surte solo ese, sin tocar pars ni stock reales.
 *
 * Nota de la base: `hotel_warehouses_lavanderia_activa_unica` (índice único
 * parcial) permite UNA sola lavandería activa, así que no se puede crear otra
 * para el test. Se reutiliza la lavandería activa existente como origen y se
 * le agregan SOLO el lote y la existencia del producto de esta corrida (se
 * borran al final); ningún renglón del cliente se modifica. Para que el usuario
 * de lavandería de la corrida vea ese almacén sin tocar su `custodianId`, se le
 * da una excepción de permiso `hotel_linen.fulfill` con alcance ALL (fila de
 * `user_permissions` de un usuario propio, que muere con él).
 */
assertSafeDatabase();

const RUN = newRunId();
/** Marcador único de la corrida, presente en cada fila que crea el spec. */
const MARK = `${E2E_PREFIX}_LINEN_${RUN}`;
/** Número de habitación único: también sirve para limpiar notificaciones por título. */
const ROOM_NUMBER = `E2E-LINEN-${RUN}`;
/** `SUPPLY_REQUEST_DOC` de `transfer.service.ts`. */
const SUPPLY_REQUEST_DOC = "HOTEL_SUPPLY_REQUEST";

/** Ids de todo lo creado, para limpiar por llave primaria (nunca por datos del cliente). */
const created = {
  users: [] as string[],
  zones: [] as string[],
  roomTypes: [] as string[],
  rooms: [] as string[],
  units: [] as string[],
  categories: [] as string[],
  products: [] as string[],
  pars: [] as string[],
  warehouses: [] as string[],
  lots: [] as string[],
};

interface Actor {
  id: string;
  name: string;
  username: string;
}

interface LinenLine {
  id: string;
  product: { id: string; code: string; name: string };
  requestedQty: number;
  deliveredQty: number;
  receivedQty: number;
  dirtyCollectedQty: number | null;
  pendingQty: number;
}

interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  kind: string;
}

interface RequestDetail {
  id: string;
  folio: string;
  status: string;
  origin: string;
  room: { id: string; number: string } | null;
  carrier: { id: string; name: string } | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  dirtyCollectedAt: string | null;
  area: WarehouseRef;
  source: WarehouseRef;
  requestingWarehouseId: string;
  sourceWarehouseId: string;
  requestedBy: { id: string; name: string };
  lines: LinenLine[];
  differences: Array<{ id: string; folio: string; status: string; notes: string | null }>;
}

interface TurnoverTodayItem {
  id: string;
  folio: string;
  status: string;
  bucket: "PENDING" | "IN_PROGRESS" | "DONE";
  origin: string;
  room: { id: string; number: string } | null;
  area: WarehouseRef;
  requestedBy: { id: string; name: string } | null;
  carrier: { id: string; name: string } | null;
  createdAt: string;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  lines: LinenLine[];
}

interface QueueResponse {
  toFulfill: TurnoverTodayItem[];
  requested: TurnoverTodayItem[];
  toPickUp: TurnoverTodayItem[];
  carrying: TurnoverTodayItem[];
  delivered: TurnoverTodayItem[];
}

let supervisor: Actor;
let laundry: Actor;
let assistant: Actor;
/** Lavandería activa existente (única por el índice parcial): es el origen del surtido. */
let laundryWarehouseId: string;
let ctxSupervisor: APIRequestContext;
let ctxLaundry: APIRequestContext;
let ctxAssistant: APIRequestContext;
const contexts: APIRequestContext[] = [];

/** Cuerpo JSON o error legible con el status y el texto que devolvió la API. */
const bodyOf = async <T>(res: APIResponse): Promise<T> => {
  const text = await res.text();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} → ${text}`);
  return JSON.parse(text) as T;
};

const iso = (value: string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * Dotación esperada de la habitación con la MISMA regla que `room-par-rules.ts`:
 * por producto LINEN, Σ cantidad del par × multiplicador del componente
 * (`ROOM` = 1, camas/baños = su cantidad). Incluye los pars del cliente a
 * propósito: el pedido debe traerlos y el test solo opera sobre el suyo.
 */
const expectedForRoom = async (roomId: string): Promise<Map<string, number>> => {
  const room = await db.hotelRoom.findUniqueOrThrow({ where: { id: roomId } });
  const pars = await db.hotelRoomPar.findMany({ where: { product: { kind: "LINEN" } } });
  const multiplier = (component: string): number => {
    switch (component) {
      case "ROOM":
        return 1;
      case "KING_BED":
        return room.kingBeds;
      case "QUEEN_BED":
        return room.queenBeds;
      case "SOFA_BED":
        return room.sofaBeds;
      case "BATHROOM":
        return room.bathrooms;
      default:
        return 0;
    }
  };
  const expected = new Map<string, number>();
  for (const par of pars) {
    const total = par.quantity * multiplier(par.component);
    if (total !== 0) expected.set(par.productId, (expected.get(par.productId) ?? 0) + total);
  }
  return expected;
};

/**
 * Borra lo que creó la corrida, en orden seguro de llaves foráneas. El alcance
 * sale de los ids que el propio test guardó: no toca un solo dato del cliente.
 * Al final comprueba que no quedó ninguna fila.
 */
const cleanupLinen = async (): Promise<void> => {
  const requestRows = await db.hotelSupplyRequest.findMany({
    where: {
      OR: [
        { roomId: { in: created.rooms } },
        { requestingWarehouseId: { in: created.warehouses } },
        { sourceWarehouseId: { in: created.warehouses } },
      ],
    },
    select: { id: true },
  });
  const requestIds = requestRows.map((r) => r.id);

  const movementRows = await db.hotelMovement.findMany({
    where: {
      OR: [
        { sourceDocId: { in: requestIds } },
        { fromWarehouseId: { in: created.warehouses } },
        { warehouseId: { in: created.warehouses } },
      ],
    },
    select: { id: true },
  });
  const movementIds = movementRows.map((m) => m.id);

  // Notificaciones: las de nuestros usuarios y las que el flujo mandó a otros
  // (p. ej. los usuarios reales con rol de lavandería). Todas llevan la
  // habitación en el título, que es única de esta corrida.
  await db.notification.deleteMany({
    where: {
      OR: [{ userId: { in: created.users } }, { title: { contains: ROOM_NUMBER } }],
    },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: created.users } },
        {
          entityId: {
            in: [
              ...requestIds,
              ...movementIds,
              ...created.rooms,
              ...created.zones,
              ...created.products,
              ...created.warehouses,
            ],
          },
        },
      ],
    },
  });
  await db.hotelSignature.deleteMany({
    where: { OR: [{ userId: { in: created.users } }, { docId: { in: movementIds } }] },
  });
  await db.hotelMovementLine.deleteMany({ where: { movementId: { in: movementIds } } });
  // Por si algún movimiento creó un lote propio (fuente del lote).
  await db.hotelLot.updateMany({
    where: { productId: { in: created.products }, sourceMovementId: { in: movementIds } },
    data: { sourceMovementId: null },
  });
  await db.hotelMovement.deleteMany({ where: { id: { in: movementIds } } });
  // La tarea cascadea sus renglones.
  await db.hotelHousekeepingTask.deleteMany({ where: { roomId: { in: created.rooms } } });
  await db.hotelSupplyRequestLine.deleteMany({ where: { requestId: { in: requestIds } } });
  await db.hotelSupplyRequest.deleteMany({ where: { id: { in: requestIds } } });
  await db.hotelStock.deleteMany({ where: { productId: { in: created.products } } });
  await db.hotelLot.deleteMany({ where: { productId: { in: created.products } } });
  await db.hotelRoomStatusChange.deleteMany({ where: { roomId: { in: created.rooms } } });
  await db.hotelRoom.deleteMany({ where: { id: { in: created.rooms } } });
  await db.hotelZoneSupervisor.deleteMany({ where: { zoneId: { in: created.zones } } });
  // Las ubicaciones cascadean con el almacén.
  await db.hotelWarehouse.deleteMany({ where: { id: { in: created.warehouses } } });
  await db.userPermission.deleteMany({ where: { userId: { in: created.users } } });
  await db.hotelRoomPar.deleteMany({ where: { id: { in: created.pars } } });
  await db.hotelProduct.deleteMany({ where: { id: { in: created.products } } });
  await db.hotelUnit.deleteMany({ where: { id: { in: created.units } } });
  await db.hotelProductCategory.deleteMany({ where: { id: { in: created.categories } } });
  await db.hotelZone.deleteMany({ where: { id: { in: created.zones } } });
  await db.hotelRoomType.deleteMany({ where: { id: { in: created.roomTypes } } });
  await db.user.deleteMany({ where: { id: { in: created.users } } });

  // Verificación explícita de que la base quedó como estaba.
  const residue = {
    pedidos: await db.hotelSupplyRequest.count({ where: { id: { in: requestIds } } }),
    lineasDePedido: await db.hotelSupplyRequestLine.count({ where: { requestId: { in: requestIds } } }),
    tareas: await db.hotelHousekeepingTask.count({ where: { roomId: { in: created.rooms } } }),
    cambiosDeEstado: await db.hotelRoomStatusChange.count({ where: { roomId: { in: created.rooms } } }),
    habitaciones: await db.hotelRoom.count({ where: { id: { in: created.rooms } } }),
    almacenes: await db.hotelWarehouse.count({ where: { id: { in: created.warehouses } } }),
    movimientos: await db.hotelMovement.count({ where: { id: { in: movementIds } } }),
    renglonesDeMovimiento: await db.hotelMovementLine.count({ where: { movementId: { in: movementIds } } }),
    firmas: await db.hotelSignature.count({ where: { OR: [{ userId: { in: created.users } }, { docId: { in: movementIds } }] } }),
    lotes: await db.hotelLot.count({ where: { id: { in: created.lots } } }),
    existencias: await db.hotelStock.count({ where: { productId: { in: created.products } } }),
    productos: await db.hotelProduct.count({ where: { id: { in: created.products } } }),
    pars: await db.hotelRoomPar.count({ where: { id: { in: created.pars } } }),
    unidades: await db.hotelUnit.count({ where: { id: { in: created.units } } }),
    categorias: await db.hotelProductCategory.count({ where: { id: { in: created.categories } } }),
    zonas: await db.hotelZone.count({ where: { id: { in: created.zones } } }),
    supervisoresDeZona: await db.hotelZoneSupervisor.count({ where: { zoneId: { in: created.zones } } }),
    tiposDeHabitacion: await db.hotelRoomType.count({ where: { id: { in: created.roomTypes } } }),
    notificaciones: await db.notification.count({
      where: { OR: [{ userId: { in: created.users } }, { title: { contains: ROOM_NUMBER } }] },
    }),
    bitacora: await db.auditLog.count({ where: { userId: { in: created.users } } }),
    excepcionesDePermiso: await db.userPermission.count({ where: { userId: { in: created.users } } }),
    usuarios: await db.user.count({ where: { id: { in: created.users } } }),
  };
  const sobrantes = Object.entries(residue).filter(([, count]) => count !== 0);
  if (sobrantes.length > 0) {
    throw new Error(`[${MARK}] La limpieza dejó filas: ${JSON.stringify(residue)}`);
  }
};

test.describe("Blancos — pedido por habitación: check-out, surtido, recogido y entrega", () => {
  test.beforeAll(async () => {
    const password = await bcrypt.hash(E2E.password, 10);

    // Actores propios de la corrida, con los roles dinámicos ya sembrados.
    const supervisorUser = await db.user.create({
      data: {
        username: `e2e_linen_super_${RUN}`.toLowerCase(),
        name: `${MARK} Supervisora`,
        role: "HOUSEKEEPING_SUPERVISOR",
        active: true,
        password,
      },
    });
    const laundryUser = await db.user.create({
      data: {
        username: `e2e_linen_laundry_${RUN}`.toLowerCase(),
        name: `${MARK} Lavandería`,
        role: "HOTEL_LAUNDRY",
        active: true,
        password,
      },
    });
    const assistantUser = await db.user.create({
      data: {
        username: `e2e_linen_floor_${RUN}`.toLowerCase(),
        name: `${MARK} Auxiliar`,
        role: "FLOOR_ASSISTANT",
        active: true,
        password,
      },
    });
    created.users.push(supervisorUser.id, laundryUser.id, assistantUser.id);
    supervisor = { id: supervisorUser.id, name: supervisorUser.name, username: supervisorUser.username };
    laundry = { id: laundryUser.id, name: laundryUser.name, username: laundryUser.username };
    assistant = { id: assistantUser.id, name: assistantUser.name, username: assistantUser.username };

    // La única lavandería activa es la base del sistema; no se puede crear otra
    // (índice único parcial). Se le da al usuario de lavandería de la corrida
    // alcance ALL sobre `hotel_linen.fulfill` para que la vea y pueda surtir sin
    // tocar el `custodianId` del almacén existente.
    await db.userPermission.create({
      data: {
        userId: laundry.id,
        permission: "hotel_linen.fulfill",
        scope: "ALL",
        reason: `${MARK} alcance de lavandería para el E2E`,
      },
    });

    // Catálogo mínimo: zona de piso, tipo sin kit y la habitación ocupada.
    const zone = await db.hotelZone.create({
      data: { name: `${MARK} Piso`, kind: "FLOOR", active: true },
    });
    created.zones.push(zone.id);

    const roomType = await db.hotelRoomType.create({
      data: { name: `${MARK} Tipo`, beds: 1, capacity: 2, active: true },
    });
    created.roomTypes.push(roomType.id);

    const room = await db.hotelRoom.create({
      data: {
        zoneId: zone.id,
        typeId: roomType.id,
        number: ROOM_NUMBER,
        status: "OCCUPIED",
        kingBeds: 1,
        queenBeds: 0,
        sofaBeds: 0,
        bathrooms: 1,
        active: true,
      },
    });
    created.rooms.push(room.id);

    // Producto LINEN propio + su dotación (el esperado de la habitación = 2).
    const unit = await db.hotelUnit.create({
      data: { name: `${MARK} Pieza`, whole: true, active: true },
    });
    created.units.push(unit.id);

    const category = await db.hotelProductCategory.create({
      data: { name: `${MARK} Blancos`, active: true },
    });
    created.categories.push(category.id);

    const product = await db.hotelProduct.create({
      data: {
        code: `E2E-LIN-${RUN}`,
        name: `${MARK} Sábana`,
        categoryId: category.id,
        unitId: unit.id,
        kind: "LINEN",
        active: true,
      },
    });
    created.products.push(product.id);

    const par = await db.hotelRoomPar.create({
      data: { component: "KING_BED", productId: product.id, quantity: 2 },
    });
    created.pars.push(par.id);

    // Origen del surtido: la lavandería activa que ya tiene la base (el índice
    // `hotel_warehouses_lavanderia_activa_unica` no permite una segunda).
    const laundryWarehouse = await db.hotelWarehouse.findFirst({
      where: { kind: "LAUNDRY", active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    });
    if (!laundryWarehouse) {
      throw new Error(`[${MARK}] No hay una lavandería activa en la base`);
    }
    laundryWarehouseId = laundryWarehouse.id;

    // Ropería (almacén del área) propia de la corrida, con sus ubicaciones.
    const zoneWarehouse = await db.hotelWarehouse.create({
      data: {
        code: `E2E-ZON-${RUN}`,
        name: `${MARK} Ropería`,
        kind: "ZONE",
        zoneId: zone.id,
        active: true,
      },
    });
    created.warehouses.push(zoneWarehouse.id);
    await db.hotelLocation.createMany({
      data: DEFAULT_LOCATIONS.ZONE.map((code, index) => ({
        warehouseId: zoneWarehouse.id,
        code,
        isDefault: index === 0,
      })),
    });

    // Stock inicial en la lavandería (ubicación CLEAN): sin esto el surtido falla.
    const cleanLocation = await db.hotelLocation.findFirstOrThrow({
      where: { warehouseId: laundryWarehouse.id, code: "CLEAN", active: true },
    });
    const lot = await db.hotelLot.create({
      data: {
        code: `E2E-LOT-${RUN}`,
        productId: product.id,
        receivedAt: new Date(),
        initialQuantity: 10,
      },
    });
    created.lots.push(lot.id);
    await db.hotelStock.create({
      data: {
        productId: product.id,
        warehouseId: laundryWarehouse.id,
        locationId: cleanLocation.id,
        lotId: lot.id,
        quantity: 10,
      },
    });

    // Supervisora y auxiliar de piso atadas a la zona: con eso ven el almacén
    // del área por alcance AREA y a la auxiliar le llega el aviso de "listo".
    await db.hotelZoneSupervisor.createMany({
      data: [
        { zoneId: zone.id, userId: supervisor.id },
        { zoneId: zone.id, userId: assistant.id },
      ],
    });

    // Guardia: no debe haber una segunda lavandería activa (el índice parcial
    // lo prohíbe) y la que se usa es la única, la misma que ve `warehouseOfKind`.
    const activeLaundries = await db.hotelWarehouse.count({ where: { kind: "LAUNDRY", active: true } });
    if (activeLaundries !== 1) {
      throw new Error(`[${MARK}] Se esperaba una sola lavandería activa y hay ${activeLaundries}`);
    }

    ctxSupervisor = await contextAuthenticated(supervisor.username);
    contexts.push(ctxSupervisor);
    ctxLaundry = await contextAuthenticated(laundry.username);
    contexts.push(ctxLaundry);
    ctxAssistant = await contextAuthenticated(assistant.username);
    contexts.push(ctxAssistant);
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map((ctx) => ctx.dispose().catch(() => undefined)));
    contexts.length = 0;
    // El cliente Prisma es compartido por todos los specs del worker: no se desconecta aquí.
    await cleanupLinen();
  });

  test("recorrido completo: check-out → extras → surtido → recogido → entrega → diferencia", async () => {
    test.setTimeout(60_000);

    // Ids propios de la corrida que necesitan los pasos.
    const roomId = created.rooms[0];
    const productId = created.products[0];
    // La lavandería es la única activa de la base; la ropería es la de la corrida.
    const zoneWarehouseId = created.warehouses[0];

    let requestId = "";
    let requestFolio = "";
    let ourLineId = "";
    let adjustment: { id: string; folio: string; status: string } | null = null;

    await test.step("1. Check-out (supervisora): crea SOLO el pedido ROOM_TURNOVER con la dotación y la tarea CHECKOUT", async () => {
      const res = await ctxSupervisor.patch(`hotel/rooms/${roomId}/status`, { data: { to: "CLEANING" } });
      expect(res.status()).toBe(200);

      // El hook del check-out corre después del commit y se traga los errores:
      // la aserción va contra la base, no contra la respuesta.
      const requests = await db.hotelSupplyRequest.findMany({
        where: { roomId },
        include: { lines: true },
      });
      expect(requests).toHaveLength(1);
      const request = requests[0];
      requestId = request.id;
      requestFolio = request.folio;

      expect(request.origin).toBe("ROOM_TURNOVER");
      expect(request.status).toBe("SUBMITTED");
      expect(request.requestedById).toBe(supervisor.id);
      expect(request.requestingWarehouseId).toBe(zoneWarehouseId);
      expect(request.sourceWarehouseId).toBe(laundryWarehouseId);
      expect(request.roomId).toBe(roomId);

      // La dotación es Σ par × camas/baños, con los pars LINEN de toda la base.
      const expected = await expectedForRoom(roomId);
      expect(request.lines).toHaveLength(expected.size);
      for (const line of request.lines) {
        expect(Number(line.requestedQty)).toBe(expected.get(line.productId));
      }
      const ours = request.lines.find((line) => line.productId === productId);
      expect(ours).toBeDefined();
      expect(Number(ours!.requestedQty)).toBe(2);

      // La tarea de limpieza del check-out se abre en la misma transacción.
      const tasks = await db.hotelHousekeepingTask.findMany({ where: { roomId } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].cleaningType).toBe("CHECKOUT");
      expect(tasks[0].status).toBe("PENDING");

      // Idempotencia del alta: "se desocupó" otra vez devuelve el mismo pedido.
      const again = await ctxSupervisor.post("hotel/linen/supply-requests/room-turnover", {
        data: { roomId },
      });
      expect(again.status()).toBe(200);
      const againBody = await bodyOf<{ created: boolean; request: RequestDetail }>(again);
      expect(againBody.created).toBe(false);
      expect(againBody.request.id).toBe(requestId);
    });

    await test.step('2. La supervisora lo ve en "Pendientes" con quién lo pidió y cuándo', async () => {
      const today = await bodyOf<TurnoverTodayItem[]>(
        await ctxSupervisor.get("hotel/linen/supply-requests/today")
      );
      const pending = today.find((item) => item.id === requestId);
      expect(pending).toBeDefined();
      expect(pending!.bucket).toBe("PENDING");
      expect(pending!.status).toBe("SUBMITTED");
      expect(pending!.room).toMatchObject({ id: roomId, number: ROOM_NUMBER });
      expect(pending!.requestedBy).toMatchObject({ id: supervisor.id, name: supervisor.name });
      expect(pending!.createdAt).toBeTruthy();
      expect(new Date(pending!.createdAt).getTime()).toBeGreaterThan(0);
    });

    await test.step("3. Extras (supervisora): el renglón del producto pasa de 2 a 3", async () => {
      const res = await ctxSupervisor.post(`hotel/linen/supply-requests/${requestId}/lines`, {
        // OJO: el DTO real pide `quantity` (no `requestedQty`).
        data: { lines: [{ productId, quantity: 1 }] },
      });
      expect(res.status()).toBe(200);
      const body = await bodyOf<RequestDetail>(res);
      const line = body.lines.find((item) => item.product.id === productId);
      expect(line).toBeDefined();
      expect(line!.requestedQty).toBe(3);
      ourLineId = line!.id;
    });

    await test.step("4. Surtir (lavandería): READY_FOR_PICKUP y traspaso IN_TRANSIT ligado al pedido", async () => {
      const res = await ctxLaundry.post(`hotel/linen/supply-requests/${requestId}/fulfill`, {
        data: { lines: [{ lineId: ourLineId, deliveredQty: 3 }] },
      });
      expect(res.status()).toBe(200);
      const body = await bodyOf<RequestDetail>(res);
      expect(body.status).toBe("READY_FOR_PICKUP");
      expect(body.readyAt).not.toBeNull();

      const transfers = await db.hotelMovement.findMany({
        where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: requestId, type: "TRANSFER" },
        include: { lines: true },
      });
      expect(transfers).toHaveLength(1);
      const transfer = transfers[0];
      expect(transfer.status).toBe("IN_TRANSIT");
      expect(transfer.fromWarehouseId).toBe(laundryWarehouseId);
      expect(transfer.warehouseId).toBe(zoneWarehouseId);
      expect(transfer.sourceDocType).toBe(SUPPLY_REQUEST_DOC);
      expect(transfer.sourceDocId).toBe(requestId);
      const ours = transfer.lines.find((line) => line.productId === productId);
      expect(ours).toBeDefined();
      expect(Number(ours!.quantity)).toBe(3);
    });

    await test.step('5. Lavandería ya no lo tiene "por surtir" y piso lo ve "por recoger"', async () => {
      const laundryQueue = await bodyOf<QueueResponse>(
        await ctxLaundry.get("hotel/linen/supply-requests/queue")
      );
      expect(laundryQueue.toFulfill.some((item) => item.id === requestId)).toBe(false);
      const laundryToday = await bodyOf<TurnoverTodayItem[]>(
        await ctxLaundry.get("hotel/linen/supply-requests/today")
      );
      const laundryItem = laundryToday.find((item) => item.id === requestId);
      expect(laundryItem).toBeDefined();
      expect(laundryItem!.bucket).toBe("IN_PROGRESS");
      expect(laundryItem!.readyAt).not.toBeNull();

      const floorQueue = await bodyOf<QueueResponse>(
        await ctxAssistant.get("hotel/linen/supply-requests/queue")
      );
      expect(floorQueue.toPickUp.some((item) => item.id === requestId)).toBe(true);
      const floorToday = await bodyOf<TurnoverTodayItem[]>(
        await ctxAssistant.get("hotel/linen/supply-requests/today")
      );
      expect(floorToday.find((item) => item.id === requestId)?.bucket).toBe("IN_PROGRESS");
    });

    await test.step("6. Recoger (auxiliar de piso): IN_TRANSIT, portadora y hora de recogida", async () => {
      const res = await ctxAssistant.post(`hotel/linen/supply-requests/${requestId}/pickup`);
      expect(res.status()).toBe(200);
      const body = await bodyOf<RequestDetail>(res);
      expect(body.status).toBe("IN_TRANSIT");
      expect(body.carrier).toMatchObject({ id: assistant.id, name: assistant.name });
      expect(body.pickedUpAt).not.toBeNull();

      const row = await db.hotelSupplyRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row.carrierUserId).toBe(assistant.id);
      expect(row.pickedUpAt).not.toBeNull();
    });

    await test.step('7. La supervisora lo ve en "En proceso" con quién lo lleva', async () => {
      const today = await bodyOf<TurnoverTodayItem[]>(
        await ctxSupervisor.get("hotel/linen/supply-requests/today")
      );
      const item = today.find((row) => row.id === requestId);
      expect(item).toBeDefined();
      expect(item!.bucket).toBe("IN_PROGRESS");
      expect(item!.status).toBe("IN_TRANSIT");
      expect(item!.carrier).toMatchObject({ id: assistant.id, name: assistant.name });
      expect(item!.pickedUpAt).not.toBeNull();
    });

    await test.step("8. Entregar (la misma auxiliar): RECEIVED, fechas y renglón recibido", async () => {
      const res = await ctxAssistant.post(`hotel/linen/supply-requests/${requestId}/deliver`, {
        data: { dirtyLines: [{ productId, quantity: 3 }] },
      });
      expect(res.status()).toBe(200);
      const body = await bodyOf<RequestDetail>(res);
      expect(body.status).toBe("RECEIVED");
      expect(body.deliveredAt).not.toBeNull();
      expect(body.dirtyCollectedAt).not.toBeNull();
      const line = body.lines.find((item) => item.product.id === productId);
      expect(line).toBeDefined();
      expect(line!.receivedQty).toBe(3);
      expect(line!.dirtyCollectedQty).toBe(3);
    });

    await test.step("9. Diferencia (supervisora): ajuste de salida ligado al pedido", async () => {
      const res = await ctxSupervisor.post(`hotel/linen/supply-requests/${requestId}/difference`, {
        data: {
          lines: [{ productId, missingQty: 1 }],
          notes: `Faltante E2E ${RUN}`,
        },
      });
      expect(res.status()).toBe(201);
      const body = await bodyOf<{
        request: RequestDetail;
        adjustment: { id: string; folio: string; status: string };
      }>(res);
      adjustment = body.adjustment;
      expect(body.adjustment.id).toBeTruthy();
      expect(body.adjustment.folio).toMatch(/^MOV-H-\d+$/);
      expect(["ACTIVE", "PENDING_APPROVAL"]).toContain(body.adjustment.status);

      const movement = await db.hotelMovement.findUniqueOrThrow({
        where: { id: body.adjustment.id },
        include: { lines: true },
      });
      expect(movement.type).toBe("ADJUST_OUT");
      expect(movement.sourceDocType).toBe(SUPPLY_REQUEST_DOC);
      expect(movement.sourceDocId).toBe(requestId);
      const ours = movement.lines.find((line) => line.productId === productId);
      expect(ours).toBeDefined();
      expect(Number(ours!.quantity)).toBe(1);
      expect(body.request.differences.some((diff) => diff.id === body.adjustment.id)).toBe(true);
    });

    await test.step('10. "Quién / dónde / cuándo": el today trae la línea de tiempo completa', async () => {
      const today = await bodyOf<TurnoverTodayItem[]>(
        await ctxSupervisor.get("hotel/linen/supply-requests/today")
      );
      const item = today.find((row) => row.id === requestId);
      expect(item).toBeDefined();
      expect(item!.status).toBe("RECEIVED");
      expect(item!.bucket).toBe("DONE");
      expect(item!.folio).toBe(requestFolio);
      expect(item!.requestedBy).toMatchObject({ id: supervisor.id, name: supervisor.name });
      expect(item!.area).toMatchObject({ id: zoneWarehouseId, kind: "ZONE" });
      expect(item!.room).toMatchObject({ id: roomId, number: ROOM_NUMBER });
      expect(item!.createdAt).toBeTruthy();
      expect(item!.readyAt).not.toBeNull();
      expect(item!.pickedUpAt).not.toBeNull();
      expect(item!.carrier).toMatchObject({ id: assistant.id, name: assistant.name });
      expect(item!.deliveredAt).not.toBeNull();
      const line = item!.lines.find((row) => row.product.id === productId);
      expect(line).toBeDefined();
      expect(line!.requestedQty).toBe(3);
      expect(line!.deliveredQty).toBe(3);
      expect(line!.receivedQty).toBe(3);
      expect(line!.dirtyCollectedQty).toBe(3);

      // `today` no expone `dirtyCollectedAt` a nivel cabecera (solo el detalle);
      // se verifica en el detalle del pedido, visible para la supervisora.
      const detail = await bodyOf<RequestDetail>(
        await ctxSupervisor.get(`hotel/linen/supply-requests/${requestId}`)
      );
      expect(detail.dirtyCollectedAt).not.toBeNull();

      const timeline = {
        folio: item!.folio,
        estado: item!.status,
        grupo: item!.bucket,
        habitacion: item!.room?.number ?? null,
        areaQuePidio: item!.area
          ? { codigo: item!.area.code, nombre: item!.area.name, tipo: item!.area.kind }
          : null,
        pedidoPor: item!.requestedBy?.name ?? null,
        creadoEn: iso(item!.createdAt),
        listoParaRecogerEn: iso(item!.readyAt),
        recogidoEn: iso(item!.pickedUpAt),
        llevadoPor: item!.carrier?.name ?? null,
        entregadoEn: iso(item!.deliveredAt),
        sucioRecogidoEn: iso(detail.dirtyCollectedAt),
        renglones: item!.lines.map((row) => ({
          producto: row.product.name,
          codigo: row.product.code,
          solicitado: row.requestedQty,
          entregado: row.deliveredQty,
          recibido: row.receivedQty,
          sucioRecogido: row.dirtyCollectedQty,
        })),
        ajustePorDiferencia: adjustment
          ? { folio: adjustment.folio, estado: adjustment.status, faltante: 1 }
          : null,
      };
      console.log(
        `\n[E2E][${MARK}] Línea de tiempo "quién/dónde/cuándo" del pedido ${item!.folio}:\n` +
          `${JSON.stringify(timeline, null, 2)}\n`
      );
    });

    await test.step("11. Notificaciones: cada aviso llegó al usuario correcto", async () => {
      const rows = await db.notification.findMany({
        where: { userId: { in: [supervisor.id, laundry.id, assistant.id] } },
        select: { userId: true, type: true, title: true },
      });
      const recipientsOf = (type: string): string[] =>
        rows
          .filter((row) => row.type === type)
          .map((row) => row.userId)
          .sort();

      expect(recipientsOf("HOTEL_LINEN_ORDER_SUBMITTED")).toEqual([laundry.id]);
      expect(recipientsOf("HOTEL_LINEN_ORDER_READY")).toEqual([assistant.id]);
      expect(recipientsOf("HOTEL_LINEN_ORDER_DELIVERED")).toEqual([supervisor.id]);
      expect(recipientsOf("HOTEL_LINEN_ORDER_DIFFERENCE")).toEqual([assistant.id, laundry.id].sort());
      // El actor no se auto-avisa.
      expect(recipientsOf("HOTEL_LINEN_ORDER_SUBMITTED")).not.toContain(supervisor.id);
    });

    await test.step("12. Idempotencia: repetir el check-out sobre CLEANING no duplica el pedido", async () => {
      const res = await ctxSupervisor.patch(`hotel/rooms/${roomId}/status`, {
        data: { to: "CLEANING" },
      });
      expect(res.status()).toBe(200);
      const count = await db.hotelSupplyRequest.count({ where: { roomId } });
      expect(count).toBe(1);
      expect((await db.hotelHousekeepingTask.count({ where: { roomId } }))).toBe(1);
    });
  });
});
