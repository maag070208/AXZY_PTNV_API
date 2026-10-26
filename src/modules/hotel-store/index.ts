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
 * Módulo del almacén del hotel, montado en `/hotel`. Expone M1 (zonas, tipos y
 * habitaciones) y M2 (unidades, categorías, productos y kits). Los movimientos
 * de M3 se agregan sobre el mismo router.
 */
export const createHotelModule = (audit?: AuditLogger): Router => {
  const rooms = new HotelRoomsService(undefined, audit);
  const catalog = new HotelCatalogService();
  const router = createRouter();
  // El router de habitaciones aplica `authenticate` a todo el módulo.
  router.use(createHotelRoomsRouter(new HotelRoomsController(rooms)));
  router.use(createHotelCatalogRouter(new HotelCatalogController(catalog)));
  return router;
};
