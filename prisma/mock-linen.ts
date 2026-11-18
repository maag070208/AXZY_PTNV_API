/**
 * Genera data de EJEMPLO de Blancos (inicio `/linen`) usando los servicios reales del módulo
 * (movimientos, traspasos, lavandería, recepción de sucios, bajas, préstamos, adicionales y equipos),
 * de modo que kardex, lotes y existencias cuadren. El escenario:
 *
 *  1. Compra (INBOUND) a ALM de los 32 blancos con 60-100 % del par (varios bajo 80 %, algunos en par).
 *  2. ALM -> NEW y NEW -> LAV (primera lavada) recibidos; una parte de LAV llega a CLEAN.
 *  3. Surtido de LAV a roperías y puntos: uno con diferencia, dos en tránsito, 2ª firma pendiente/conforme/diferencia.
 *  4. Recepción de sucios de HN con faltante hoy y piezas rotas a QUARANTINE.
 *  5. Dos bajas pendientes (una por revisar, una revisada por autorizar), motivo F.
 *  6. Un pedido de área SUBMITTED sin surtir (VI) y uno surtido y recibido (HN).
 *  7. Préstamos de toallas abiertos en AP y AT con depósito.
 *  8. Un adicional a habitación abierto y 3 secadoras (una prestada, una en reparación).
 *  9. Dotación mínima por habitación (HotelRoomPar) si estaba vacía.
 *
 * Precondiciones: `npm run linen:setup`, `linen:catalog` y `linen:rooms`.
 *
 * Uso:  npm run mock:linen             (borra lo marcado y regenera; idempotente)
 *       npm run mock:linen -- --clean  (solo borra lo marcado)
 *       npm run mock:linen -- --report (imprime el tablero y los totales de existencias, sin cambiar nada)
 *       npm run mock:linen -- --yes    (permite una base que no es local)
 *
 * Marcas: notas con `[MOCK-LINEN]`, requestId `mock-linen:*`, usuarios `mock.linen.*`, equipos con la nota.
 * Límite del borrado: se elimina la existencia de los lotes de la compra mock; si un movimiento real
 * consumió esos lotes, ese saldo no se puede revertir (la base de desarrollo no lo hace).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import { hashPassword } from "@core/utils/security";
import { HotelMovementService } from "@modules/hotel-store/services/movement.service";
import { HotelSignatureService } from "@modules/hotel-store/linen/services/signature.service";
import { signCosignToken } from "@modules/hotel-store/linen/services/cosign-token";
import { HotelLinenTransferService, SUPPLY_REQUEST_DOC } from "@modules/hotel-store/linen/services/transfer.service";
import { HotelLaundryService } from "@modules/hotel-store/linen/services/laundry.service";
import { HotelSupplyRequestService } from "@modules/hotel-store/linen/services/supply-request.service";
import { HotelDirtyReceiptService } from "@modules/hotel-store/linen/services/dirty-receipt.service";
import { HotelWriteoffService } from "@modules/hotel-store/linen/services/writeoff.service";
import { HotelLoanService, LOAN_DOC } from "@modules/hotel-store/linen/services/loan.service";
import { HotelExtraService } from "@modules/hotel-store/linen/services/extra.service";
import { HotelEquipmentService } from "@modules/hotel-store/linen/services/equipment.service";
import { HotelTransferSignoffService } from "@modules/hotel-store/linen/services/signoff.service";
import { HotelRoomParService } from "@modules/hotel-store/linen/services/room-par.service";
import { HotelLinenStockService } from "@modules/hotel-store/linen/services/linen-stock.service";
import { HotelLinenReportService, type DashboardScope } from "@modules/hotel-store/linen/services/report.service";
import { locationIdByCode } from "@modules/hotel-store/linen/services/linen-locations";
import { WRITEOFF_HOLD_DOC } from "@modules/hotel-store/linen/services/writeoff-rules";

const prisma = new PrismaClient();

const MARK = "[MOCK-LINEN]";
const REQ = "mock-linen:";
const PASSWORD = "MockLinen#2026";
const USERS = {
  ops: { username: "mock.linen.ops", name: "Mock Linen Gerente Ops", role: "HOTEL_OPS_MANAGER" },
  supervisor: { username: "mock.linen.supervisor", name: "Mock Linen Supervisora General", role: "HOTEL_GENERAL_SUPERVISOR" },
  housekeeping: { username: "mock.linen.housekeeping", name: "Mock Linen Supervisora de Área", role: "HOUSEKEEPING_SUPERVISOR" },
  laundry: { username: "mock.linen.laundry", name: "Mock Linen Lavandería", role: "HOTEL_LAUNDRY" },
  floor: { username: "mock.linen.floor", name: "Mock Linen Auxiliar de Piso", role: "FLOOR_ASSISTANT" },
  reception: { username: "mock.linen.reception", name: "Mock Linen Recepción", role: "RECEPCION" },
} as const;
type UserKey = keyof typeof USERS;
const ROOM_PARS_FLAG = "MOCK_LINEN_ROOM_PARS";

const assertLocalDatabase = () => {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.argv.includes("--yes")) {
    throw new Error("mock:linen only runs against a local database; pass --yes to force it");
  }
};

// Servicios reales, armados como en `createHotelModule` (sin auditoría ni notificaciones).
const movements = new HotelMovementService();
const signatures = new HotelSignatureService();
const transfers = new HotelLinenTransferService(undefined, movements, signatures);
const laundry = new HotelLaundryService(undefined, movements, transfers);
const supply = new HotelSupplyRequestService(undefined, transfers, signatures);
const dirty = new HotelDirtyReceiptService(undefined, movements, signatures);
const writeoffs = new HotelWriteoffService(undefined, movements, signatures);
const loans = new HotelLoanService(undefined, movements);
const extras = new HotelExtraService(undefined, movements, signatures);
const equipment = new HotelEquipmentService(undefined, signatures);
const signoffs = new HotelTransferSignoffService(undefined, signatures);
const roomPars = new HotelRoomParService();

// ── Borrado ────────────────────────────────────────────────────────────────

async function clean() {
  const contains = { contains: MARK };
  const units = await prisma.hotelEquipmentUnit.findMany({ where: { notes: contains }, select: { id: true } });
  const equipmentLoans = await prisma.hotelEquipmentLoan.findMany({
    where: { OR: [{ notes: contains }, { unitId: { in: units.map((u) => u.id) } }] },
    select: { id: true },
  });
  const towelLoans = await prisma.hotelTowelLoan.findMany({ where: { OR: [{ notes: contains }, { guestName: contains }] }, select: { id: true } });
  const roomExtras = await prisma.hotelRoomExtra.findMany({ where: { notes: contains }, select: { id: true, movementId: true } });
  const receipts = await prisma.hotelDirtyReceipt.findMany({ where: { notes: contains }, select: { id: true, movementId: true } });
  const requests = await prisma.hotelSupplyRequest.findMany({ where: { notes: contains }, select: { id: true } });

  const direct = await prisma.hotelMovement.findMany({
    where: { OR: [{ requestId: { startsWith: REQ } }, { notes: contains }] },
    select: { id: true },
  });
  const directIds = direct.map((m) => m.id);
  const linked = await prisma.hotelMovement.findMany({
    where: {
      OR: [
        { sourceDocType: LOAN_DOC, sourceDocId: { in: towelLoans.map((l) => l.id) } },
        { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: { in: requests.map((r) => r.id) } },
        { sourceDocType: WRITEOFF_HOLD_DOC, sourceDocId: { in: directIds } },
        { id: { in: [...roomExtras, ...receipts].map((d) => d.movementId).filter((id): id is string => !!id) } },
      ],
    },
    select: { id: true },
  });
  const movementIds = [...new Set([...directIds, ...linked.map((m) => m.id)])];
  const lots = await prisma.hotelLot.findMany({ where: { sourceMovementId: { in: movementIds } }, select: { id: true } });
  const lotIds = lots.map((l) => l.id);

  // Orden inverso a la creación: documentos hijos, firmas, existencias, movimientos (líneas en cascada) y lotes.
  await prisma.hotelEquipmentLoan.deleteMany({ where: { id: { in: equipmentLoans.map((l) => l.id) } } });
  await prisma.hotelEquipmentUnit.deleteMany({ where: { id: { in: units.map((u) => u.id) } } });
  await prisma.hotelTowelLoan.deleteMany({ where: { id: { in: towelLoans.map((l) => l.id) } } });
  await prisma.hotelRoomExtra.deleteMany({ where: { id: { in: roomExtras.map((e) => e.id) } } });
  await prisma.hotelDirtyReceipt.deleteMany({ where: { id: { in: receipts.map((r) => r.id) } } });
  await prisma.hotelSupplyRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });
  await prisma.hotelWashCycle.deleteMany({ where: { OR: [{ movementId: { in: movementIds } }, { lotId: { in: lotIds } }] } });
  const docIds = [...movementIds, ...receipts.map((r) => r.id), ...requests.map((r) => r.id), ...equipmentLoans.map((l) => l.id)];
  await prisma.hotelSignature.deleteMany({ where: { docId: { in: docIds } } });
  await prisma.hotelStock.deleteMany({ where: { lotId: { in: lotIds } } });
  await prisma.hotelMovement.deleteMany({ where: { id: { in: movementIds } } });
  let lotsLeft = 0;
  for (const id of lotIds) {
    try {
      await prisma.hotelLot.delete({ where: { id } });
    } catch {
      lotsLeft += 1; // un movimiento real los usa: se conserva
    }
  }

  // Dotación: solo si la creó este script.
  const flag = await prisma.sysConfig.findUnique({ where: { key: ROOM_PARS_FLAG } });
  if (flag) {
    await prisma.hotelRoomPar.deleteMany({ where: { product: { kind: "LINEN" } } });
    await prisma.sysConfig.delete({ where: { key: ROOM_PARS_FLAG } });
  }

  // Usuarios mock: se borran si ya nadie los referencia; si no, quedan desactivados.
  let usersKept = 0;
  for (const u of Object.values(USERS)) {
    const user = await prisma.user.findUnique({ where: { username: u.username }, select: { id: true } });
    if (!user) continue;
    try {
      await prisma.user.delete({ where: { id: user.id } });
    } catch {
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      usersKept += 1;
    }
  }
  console.log(
    `Borrado: ${movementIds.length} movimientos, ${receipts.length} recepciones de sucios, ${requests.length} pedidos, ` +
      `${towelLoans.length} préstamos, ${roomExtras.length} adicionales, ${units.length} equipos` +
      `${lotsLeft ? ` (${lotsLeft} lotes conservados por uso real)` : ""}${usersKept ? ` (${usersKept} usuarios mock desactivados)` : ""}.`
  );
}

// ── Escenario ──────────────────────────────────────────────────────────────

async function ensureUsers() {
  const out = {} as Record<UserKey, string>;
  const password = await hashPassword(PASSWORD);
  for (const [key, u] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
    const role = await prisma.role.findUnique({ where: { key: u.role }, select: { key: true } });
    if (!role) throw new Error(`Role ${u.role} does not exist; run the migrations/seed first`);
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { active: true, role: u.role },
      create: { username: u.username, name: u.name, password, role: u.role, active: true },
    });
    out[key] = user.id;
  }
  return out;
}

async function pickAdmin(): Promise<string> {
  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true, NOT: { username: { startsWith: "e2e" } } }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  if (!admin) throw new Error("No active ADMIN user found");
  return admin.id;
}

/** Recibe un traspaso completo, o con `short` piezas menos en su primera línea. */
async function receive(movementId: string, actorId: string, short = 0) {
  const movement = await prisma.hotelMovement.findUniqueOrThrow({ where: { id: movementId }, include: { lines: true } });
  await transfers.receive(
    movementId,
    { lines: movement.lines.map((l, i) => ({ lineId: l.id, receivedQuantity: Number(l.quantity) - (i === 0 ? short : 0) })), notes: MARK },
    actorId
  );
}

async function generate() {
  const admin = await pickAdmin();
  const u = await ensureUsers();

  const warehouses = new Map((await prisma.hotelWarehouse.findMany({ select: { id: true, code: true } })).map((w) => [w.code, w.id]));
  const wh = (code: string) => {
    const id = warehouses.get(code);
    if (!id) throw new Error(`Warehouse ${code} not found; run npm run linen:setup`);
    return id;
  };
  const products = await prisma.hotelProduct.findMany({ where: { kind: "LINEN", active: true }, orderBy: { code: "asc" } });
  if (products.length === 0) throw new Error("No LINEN products; run npm run linen:catalog");
  const pid = (code: string) => {
    const p = products.find((x) => x.code === code);
    if (!p) throw new Error(`Product ${code} not found`);
    return p.id;
  };
  const cleanLoc = await locationIdByCode(prisma, wh("LAV"), "CLEAN");

  // 1. Compra a ALM: 60-100 % del par, a costo lastCost.
  const PCT = [0.62, 0.71, 0.78, 0.85, 0.92, 0.95, 1, 0.68];
  const bought = new Map<string, number>();
  await movements.post(
    {
      type: "INBOUND",
      warehouseId: wh("ALM"),
      notes: `${MARK} Compra inicial de blancos`,
      lines: products.map((p, i) => {
        const par = Number(p.idealStock);
        const quantity = par > 0 ? Math.ceil(par * PCT[i % PCT.length]) : 20;
        bought.set(p.id, quantity);
        return { productId: p.id, quantity, unitCost: Number(p.lastCost ?? 0) };
      }),
    },
    admin,
    `${REQ}inbound`
  );

  // 2. ALM -> NEW (60 %), recibido por Gerente Ops.
  const toNew = new Map(products.map((p) => [p.id, Math.floor(bought.get(p.id)! * 0.6)]));
  const almNew = await transfers.send(
    {
      fromWarehouseId: wh("ALM"),
      toWarehouseId: wh("NEW"),
      notes: `${MARK} Traspaso ALM a NEW`,
      lines: products.map((p) => ({ productId: p.id, quantity: toNew.get(p.id)! })),
    },
    admin,
    `${REQ}alm-new`
  );
  await receive(almNew.id, u.ops);

  // NEW -> LAV (primera lavada, 70 %), recibido por Lavandería y 75 % de eso llega a CLEAN.
  const firstWash = new Map(products.map((p) => [p.id, Math.floor(toNew.get(p.id)! * 0.7)]));
  const wash = await laundry.firstWash(
    {
      notes: `${MARK} Primera lavada`,
      lines: products.map((p) => ({ productId: p.id, quantity: firstWash.get(p.id)! })),
    },
    admin,
    `${REQ}first-wash`
  );
  await receive(wash.id, u.laundry);
  const clean = new Map(products.map((p) => [p.id, Math.floor(firstWash.get(p.id)! * 0.75)]));
  await laundry.process(
    {
      notes: `${MARK} Lavado a limpio`,
      moves: products.map((p) => ({ productId: p.id, quantity: clean.get(p.id)!, from: "IN_PROCESS" as const, to: "CLEAN" as const })),
    },
    u.laundry
  );

  // 3. Surtido de LAV (CLEAN) a roperías y puntos.
  const ROOMS_SET = ["BL-001", "BL-002", "BL-003", "BL-005", "BL-006", "BL-007", "BL-016", "BL-017", "BL-028", "BL-030"];
  const send = async (area: string, codes: string[], fraction: number, tag: string) => {
    const moved = await transfers.send(
      {
        fromWarehouseId: wh("LAV"),
        toWarehouseId: wh(area),
        notes: `${MARK} Surtido a ${area}`,
        lines: codes.map((code) => ({
          productId: pid(code),
          quantity: Math.max(1, Math.floor(clean.get(pid(code))! * fraction)),
          fromLocationId: cleanLoc,
        })),
      },
      admin,
      `${REQ}${tag}`
    );
    return moved.id;
  };
  const hn = await send("HN", ROOMS_SET, 0.12, "lav-hn");
  const hs = await send("HS", ROOMS_SET, 0.1, "lav-hs");
  await send("VI", ROOMS_SET, 0.08, "lav-vi"); // en tránsito
  await send("JR", ROOMS_SET, 0.08, "lav-jr"); // en tránsito
  const rec = await send("REC", ["BL-001", "BL-002", "BL-005"], 0.04, "lav-rec");
  const ap = await send("AP", ["BL-004"], 0.08, "lav-ap");
  const at = await send("AT", ["BL-004"], 0.08, "lav-at");
  const spa = await send("SPA", ["BL-001", "BL-002"], 0.04, "lav-spa");

  await receive(hn, u.housekeeping);
  await receive(hs, u.housekeeping, 3); // con diferencia
  await receive(rec, u.reception);
  await receive(ap, u.reception);
  await receive(at, u.reception);
  await receive(spa, u.housekeeping);
  // 2ª firma: HN y AT conformes, HS con diferencia; AP y SPA quedan pendientes.
  await signoffs.sign(hn, { result: "CONFORM" }, u.supervisor);
  await signoffs.sign(at, { result: "CONFORM" }, u.supervisor);
  await signoffs.sign(hs, { result: "DIFFERENCE", notes: `${MARK} Faltan 3 piezas al contar` }, u.supervisor);

  // 6. Pedidos de área: HN surtido y recibido (base de la conciliación); VI por surtir.
  const supplyHn = await supply.create(
    {
      requestingWarehouseId: wh("HN"),
      checkouts: 12,
      occupied: 30,
      shift: "MATUTINO",
      notes: `${MARK} Pedido HN`,
      lines: [
        { productId: pid("BL-001"), requestedQty: 60 },
        { productId: pid("BL-002"), requestedQty: 30 },
      ],
    },
    u.housekeeping
  );
  await supply.submit(supplyHn.id, u.housekeeping);
  const hnLines = await prisma.hotelSupplyRequestLine.findMany({ where: { requestId: supplyHn.id } });
  await supply.fulfill(supplyHn.id, { lines: hnLines.map((l) => ({ lineId: l.id, deliveredQty: Number(l.requestedQty) })) }, u.laundry);
  const supplyMove = await prisma.hotelMovement.findFirstOrThrow({ where: { sourceDocType: SUPPLY_REQUEST_DOC, sourceDocId: supplyHn.id } });
  await receive(supplyMove.id, u.floor);
  const supplyVi = await supply.create(
    {
      requestingWarehouseId: wh("VI"),
      checkouts: 8,
      occupied: 20,
      shift: "MATUTINO",
      notes: `${MARK} Pedido VI por surtir`,
      lines: [
        { productId: pid("BL-001"), requestedQty: 40 },
        { productId: pid("BL-003"), requestedQty: 20 },
      ],
    },
    u.housekeeping
  );
  await supply.submit(supplyVi.id, u.housekeeping);

  // 4. Recepción de sucios de HN con faltante hoy y piezas rotas a QUARANTINE.
  await dirty.create(
    {
      originWarehouseId: wh("HN"),
      cartNumber: "C-01",
      shift: "MATUTINO",
      notes: `${MARK} Recepción de sucios HN`,
      cosignToken: signCosignToken(u.floor, env.JWT_SECRET),
      lines: [
        { productId: pid("BL-001"), receivedDirty: 40, stillInUse: 10, good: 32, stained: 4, damaged: 4 },
        { productId: pid("BL-002"), receivedDirty: 24, stillInUse: 3, good: 22, stained: 1, damaged: 1 },
      ],
    },
    u.laundry
  );

  // 5. Bajas por faltante (F, sin foto): una por revisar y otra revisada por autorizar.
  await writeoffs.create({ warehouseId: wh("HS"), lines: [{ productId: pid("BL-002"), quantity: 3, reasonCode: "F" }], notes: `${MARK} Faltante por revisar` }, [], u.housekeeping);
  const [toAuthorize] = await writeoffs.create(
    { warehouseId: wh("HS"), lines: [{ productId: pid("BL-003"), quantity: 4, reasonCode: "F" }], notes: `${MARK} Faltante por autorizar` },
    [],
    u.housekeeping
  );
  await writeoffs.review(toAuthorize.id, u.ops, u.ops, "SESSION", `${MARK} Revisada`);

  // 7. Préstamos de toallas abiertos en AP y AT.
  await loans.create({ warehouseId: wh("AP"), productId: pid("BL-004"), quantity: 3, guestName: `${MARK} Huésped Alberca pública`, depositMethod: "CASH" }, u.reception);
  await loans.create({ warehouseId: wh("AT"), productId: pid("BL-004"), quantity: 2, guestName: `${MARK} Huésped Alberca techada`, room: "HN120", depositMethod: "ROOM_CHARGE" }, u.reception);

  // 8. Adicional a habitación abierto (desde REC) y equipos.
  const rooms = await prisma.hotelRoom.findMany({ where: { active: true }, orderBy: { number: "asc" }, take: 3, select: { id: true } });
  if (rooms.length < 2) throw new Error("At least 2 active rooms are required; run npm run linen:rooms");
  await extras.create({ roomId: rooms[0].id, productId: pid("BL-005"), quantity: 1, warehouseId: wh("REC"), notes: `${MARK} Almohada extra` }, u.reception, { id: wh("REC") });

  const secadora = await prisma.hotelProduct.findFirst({ where: { code: "EQ-SEC" }, select: { id: true, kind: true } });
  const equipmentProduct =
    secadora ??
    (await (async () => {
      const unit = await prisma.hotelUnit.findFirstOrThrow({ select: { id: true } });
      return prisma.hotelProduct.create({ data: { code: "EQ-SEC", name: "Secadora de pelo", kind: "EQUIPMENT", tagPrefix: "SEC", unitId: unit.id } });
    })());
  await equipment.createUnits({ productId: equipmentProduct.id, quantity: 3, notes: MARK }, admin);
  const tags = await prisma.hotelEquipmentUnit.findMany({ where: { notes: MARK }, orderBy: { tag: "asc" }, select: { id: true } });
  const loanA = await equipment.createLoan({ unitId: tags[0].id, roomId: rooms[0].id, notes: `${MARK} Equipo prestado` }, u.reception);
  await equipment.deliver(loanA.id, {}, u.floor);
  const loanB = await equipment.createLoan({ unitId: tags[1].id, roomId: rooms[1].id, notes: `${MARK} Equipo dañado` }, u.reception);
  await equipment.deliver(loanB.id, {}, u.floor);
  await equipment.returnLoan(loanB.id, { condition: "DAMAGED", notes: `${MARK} No enciende`, chargeAmount: 0 }, u.reception);

  // 9. Dotación mínima por habitación si no hay.
  const hasPars = (await prisma.hotelRoomPar.count({ where: { product: { kind: "LINEN" } } })) > 0;
  let pars = 0;
  if (!hasPars) {
    const lines = [
      { component: "ROOM" as const, code: "BL-003", quantity: 1 },
      { component: "BATHROOM" as const, code: "BL-001", quantity: 2 },
      { component: "BATHROOM" as const, code: "BL-002", quantity: 2 },
      { component: "KING_BED" as const, code: "BL-028", quantity: 2 },
      { component: "KING_BED" as const, code: "BL-017", quantity: 2 },
      { component: "QUEEN_BED" as const, code: "BL-030", quantity: 2 },
      { component: "QUEEN_BED" as const, code: "BL-016", quantity: 2 },
      { component: "SOFA_BED" as const, code: "BL-031", quantity: 1 },
    ];
    await roomPars.save({ kind: "LINEN", lines: lines.map((l) => ({ component: l.component, productId: pid(l.code), quantity: l.quantity })) }, admin);
    await prisma.sysConfig.create({ data: { key: ROOM_PARS_FLAG, value: "1", description: "mock:linen creó la dotación mínima de blancos" } });
    pars = lines.length;
  }
  console.log(`Listo: escenario de Blancos generado (dotación nueva: ${pars} renglones). Usuarios mock.linen.* con contraseña ${PASSWORD}.`);
}

// ── Reporte ────────────────────────────────────────────────────────────────

async function report() {
  const stock = new HotelLinenStockService();
  const reports = new HotelLinenReportService(undefined, stock, writeoffs);
  const can = Object.fromEntries(
    ["transfers", "writeoffReview", "writeoffApprove", "reconciliation", "loans", "extras", "equipment", "requests", "purchase", "purchaseApprove"].map((k) => [k, true])
  ) as DashboardScope["can"];
  const dashboard = await reports.dashboard({ visibleIds: null, receivableIds: null, signoffIds: null, can });
  const { generatedAt: _generatedAt, inWarehouses: _inWarehouses, ...counters } = dashboard;
  console.log("DASHBOARD", JSON.stringify(counters));
  const summary = await stock.summary(null, "LINEN");
  const lights: Record<string, number> = {};
  for (const row of summary) lights[row.light] = (lights[row.light] ?? 0) + 1;
  console.log(
    "STOCK SUMMARY",
    JSON.stringify({
      items: summary.length,
      totalPieces: summary.reduce((s, r) => s + r.total, 0),
      inTransit: summary.reduce((s, r) => s + r.inTransit, 0),
      par: summary.reduce((s, r) => s + r.par, 0),
      lights,
      below80: summary.filter((r) => r.pct !== null && r.pct < 0.8).length,
    })
  );
}

async function main() {
  assertLocalDatabase();
  if (process.argv.includes("--report")) return report();
  await clean();
  if (process.argv.includes("--clean")) return;
  await generate();
  await report();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await prismaClient.$disconnect();
  });
