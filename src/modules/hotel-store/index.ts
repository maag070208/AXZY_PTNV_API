import { Router as createRouter, type Router } from "express";
import type { AuditLogger } from "@modules/users/services/user.service";
import { HotelRoomsService } from "./services/rooms.service";
import { HotelRoomsController } from "./controllers/rooms.controller";
import { createHotelRoomsRouter } from "./routes/rooms.routes";
import { HotelCatalogService } from "./services/hotel-catalog.service";
import { HotelCatalogController } from "./controllers/catalog.controller";
import { createHotelCatalogRouter } from "./routes/catalog.routes";
import { HotelWarehouseService } from "./services/warehouse.service";
import { HotelMovementService } from "./services/movement.service";
import { HotelStockService } from "./services/stock.service";
import { HotelStoreController } from "./controllers/store.controller";
import { createHotelStoreRouter } from "./routes/store.routes";
import { HotelInitialLoadService } from "./services/initial-load.service";
import { HotelInitialLoadController } from "./controllers/initial-load.controller";
import { HotelStocktakeService } from "./services/stocktake.service";
import { HotelStocktakeController } from "./controllers/stocktake.controller";
import { HotelHousekeepingService } from "./services/housekeeping.service";
import { HotelHousekeepingController } from "./controllers/housekeeping.controller";
import { createHotelHousekeepingRouter } from "./routes/housekeeping.routes";
import { createHotelStocktakeRouter } from "./routes/stocktake.routes";
import { HotelSignatureService } from "./linen/services/signature.service";
import { HotelSignatureController } from "./linen/controllers/signature.controller";
import { createHotelLinenRouter } from "./linen/routes/linen.routes";
import { HotelLinenTransferService } from "./linen/services/transfer.service";
import { HotelLinenStockService } from "./linen/services/linen-stock.service";
import { HotelLinenController } from "./linen/controllers/linen.controller";
import { HotelLaundryService } from "./linen/services/laundry.service";
import { HotelSupplyRequestService } from "./linen/services/supply-request.service";
import { HotelDirtyReceiptService } from "./linen/services/dirty-receipt.service";
import { HotelLaundryController } from "./linen/controllers/laundry.controller";
import { createHotelLaundryRouter } from "./linen/routes/laundry.routes";
import { HotelWriteoffService } from "./linen/services/writeoff.service";
import { HotelWriteoffController } from "./linen/controllers/writeoff.controller";
import { createHotelWriteoffRouter } from "./linen/routes/writeoff.routes";
import { HotelAmenityService } from "./linen/services/amenity.service";
import { HotelAmenityController } from "./linen/controllers/amenity.controller";
import { createHotelAmenityRouter } from "./linen/routes/amenity.routes";
import { HotelPurchaseOrderService } from "./linen/services/purchase-order.service";
import { HotelPurchaseReceiptService } from "./linen/services/purchase-receipt.service";
import { HotelPurchaseRequestService } from "./linen/services/purchase-request.service";
import { HotelPurchaseController } from "./linen/controllers/purchase.controller";
import { createHotelPurchaseRouter } from "./linen/routes/purchase.routes";
import { HotelLoanService } from "./linen/services/loan.service";
import { HotelShiftCloseService } from "./linen/services/loan-shift-close.service";
import { HotelExtraService } from "./linen/services/extra.service";
import { HotelEquipmentService, type EquipmentTicketPort } from "./linen/services/equipment.service";
import { HotelLoanController } from "./linen/controllers/loan.controller";
import { HotelExtraController } from "./linen/controllers/extra.controller";
import { HotelEquipmentController } from "./linen/controllers/equipment.controller";
import { createHotelReceptionRouter } from "./linen/routes/loan.routes";
import { HotelLinenReportService } from "./linen/services/report.service";
import { HotelLinenReportController } from "./linen/controllers/report.controller";
import { createHotelLinenReportRouter } from "./linen/routes/report.routes";
import type { NotificationPort } from "@modules/notifications";

// Job diario de reposición (bajo mínimo): lo arranca `src/index.ts` con el servicio creado por el módulo.
let purchaseRequestsService: HotelPurchaseRequestService | null = null;
export const startHotelPurchaseWorker = (): void => purchaseRequestsService?.startDailyCheck();

/**
 * Hotel store module, mounted at `/hotel`. Exposes M1 (zones, room types and rooms),
 * M2 (units, categories, products and kits) and M3 (warehouses, stock and movements).
 */
export const createHotelModule = (
  audit?: AuditLogger,
  notifications?: Pick<NotificationPort, "createManyNotifications">,
  tickets?: EquipmentTicketPort
): Router => {
  // Rooms open their housekeeping task through a callback, which avoids a service cycle.
  const rooms: HotelRoomsService = new HotelRoomsService(undefined, audit, (tx, room, cleaningType) =>
    housekeeping.openForRoom(tx, room, cleaningType)
  );
  const catalog = new HotelCatalogService();
  const warehouses = new HotelWarehouseService();
  const movements = new HotelMovementService();
  const store = new HotelStoreController(warehouses, movements, new HotelStockService());
  const initialLoad = new HotelInitialLoadController(new HotelInitialLoadService(undefined, movements), warehouses);
  const housekeeping = new HotelHousekeepingService(undefined, movements, (room) => rooms.inspectionRequired(room), audit);
  const router = createRouter();
  // The rooms router applies `authenticate` to the whole module.
  router.use(createHotelRoomsRouter(new HotelRoomsController(rooms)));
  router.use(createHotelCatalogRouter(new HotelCatalogController(catalog)));
  router.use(createHotelStoreRouter(store, initialLoad));
  const stocktakes = new HotelStocktakeController(new HotelStocktakeService(undefined, movements, audit), warehouses);
  router.use(createHotelStocktakeRouter(stocktakes));
  router.use(createHotelHousekeepingRouter(new HotelHousekeepingController(housekeeping, rooms)));
  // Blancos (linen): firmas y, en fases siguientes, traspasos, lavandería, bajas, etc.
  const signatures = new HotelSignatureService(undefined, audit);
  const transfers = new HotelLinenTransferService(undefined, movements, signatures, audit);
  const linen = new HotelLinenController(transfers, new HotelLinenStockService(), warehouses);
  router.use("/linen", createHotelLinenRouter(new HotelSignatureController(signatures), linen));
  // Ciclo de lavandería: primera lavada, proceso, pedidos de área, recepción de sucios y conciliación.
  const laundry = new HotelLaundryController(
    new HotelLaundryService(undefined, movements, transfers, audit),
    new HotelSupplyRequestService(undefined, transfers, signatures, audit),
    new HotelDirtyReceiptService(undefined, movements, signatures, audit, notifications),
    warehouses
  );
  router.use("/linen", createHotelLaundryRouter(laundry));
  // Compras y reposición: OC del hotel, recepción contra factura con apartado y solicitudes de reposición.
  const purchaseOrders = new HotelPurchaseOrderService(undefined, audit);
  purchaseRequestsService = new HotelPurchaseRequestService(undefined, audit, notifications);
  router.use(
    "/linen",
    createHotelPurchaseRouter(
      new HotelPurchaseController(purchaseOrders, new HotelPurchaseReceiptService(undefined, movements, purchaseOrders, audit), purchaseRequestsService)
    )
  );
  // Control semanal de amenidades, bodega bajo mínimo y Spa.
  router.use("/linen", createHotelAmenityRouter(new HotelAmenityController(new HotelAmenityService(undefined, signatures, audit, notifications), warehouses)));
  // Bajas de blancos y estado físico (F3).
  router.use("/linen", createHotelWriteoffRouter(new HotelWriteoffController(new HotelWriteoffService(undefined, movements, signatures, audit, notifications), signatures, warehouses)));
  // Recepción (F4): préstamo de toallas y corte de turno, adicionales a habitación y equipos por pieza.
  router.use(
    "/linen",
    createHotelReceptionRouter(
      new HotelLoanController(new HotelLoanService(undefined, movements, audit), new HotelShiftCloseService(undefined, movements, signatures, audit), warehouses),
      new HotelExtraController(new HotelExtraService(undefined, movements, signatures, audit, notifications), warehouses, rooms),
      new HotelEquipmentController(new HotelEquipmentService(undefined, signatures, audit, notifications, tickets), rooms)
    )
  );
  // Reportes y tablero (F7): solo lecturas.
  router.use(
    "/linen",
    createHotelLinenReportRouter(
      new HotelLinenReportController(
        new HotelLinenReportService(undefined, new HotelLinenStockService(), new HotelWriteoffService(undefined, movements, signatures, audit, notifications)),
        warehouses
      )
    )
  );
  return router;
};
