import type { Router } from "express";
import type { AuditLogger } from "@modules/users/services/user.service";
import { HotelRoomsService } from "./services/rooms.service";
import { HotelRoomsController } from "./controllers/rooms.controller";
import { createHotelRoomsRouter } from "./routes/rooms.routes";

/**
 * Módulo del almacén del hotel. En F1 expone lo de M1 (zonas, tipos y
 * habitaciones); M2 (productos, kits, proveedores) y los movimientos de M3
 * se van agregando sobre el mismo router `/hotel`.
 */
export const createHotelModule = (audit?: AuditLogger): Router => {
  const rooms = new HotelRoomsService(undefined, audit);
  return createHotelRoomsRouter(new HotelRoomsController(rooms));
};
