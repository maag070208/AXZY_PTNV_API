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

/**
 * Hotel store module, mounted at `/hotel`. Exposes M1 (zones, room types and rooms),
 * M2 (units, categories, products and kits) and M3 (warehouses, stock and movements).
 */
export const createHotelModule = (audit?: AuditLogger): Router => {
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
  return router;
};
