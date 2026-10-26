import type { Router } from "express";
import type { AuditLogger } from "@modules/users/services/user.service";
import { HotelRoomsService } from "./services/rooms.service";
import { HotelRoomsController } from "./controllers/rooms.controller";
import { createHotelRoomsRouter } from "./routes/rooms.routes";
import { HotelCatalogService } from "./services/hotel-catalog.service";
import { HotelCatalogController } from "./controllers/catalog.controller";
import { createHotelCatalogRouter } from "./routes/catalog.routes";
import { Router as createRouter } from "express";

/**
 * Hotel store module, mounted at `/hotel`. Exposes M1 (zones, room types and
 * rooms) and M2 (units, categories, products and kits). Warehouse movements
 * (M3) are added to the same router.
 */
export const createHotelModule = (audit?: AuditLogger): Router => {
  const rooms = new HotelRoomsService(undefined, audit);
  const catalog = new HotelCatalogService();
  const router = createRouter();
  // The rooms router applies `authenticate` to the whole module.
  router.use(createHotelRoomsRouter(new HotelRoomsController(rooms)));
  router.use(createHotelCatalogRouter(new HotelCatalogController(catalog)));
  return router;
};
