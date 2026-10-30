import { Router } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import { authenticate, requiresAnyPermission, requiresPermission } from "@core/middlewares/auth.middleware";
import type { HotelRoomsController } from "../controllers/rooms.controller";

export const createHotelRoomsRouter = (controller: HotelRoomsController): Router => {
  const router = Router();
  router.use(authenticate);

  // Zonas
  router.get("/zones", requiresPermission("hotel_rooms.view"), asyncHandler(controller.zones));
  router.post("/zones", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.createZone));
  router.patch("/zones/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.updateZone));
  router.delete("/zones/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.removeZone));
  router.put(
    "/zones/:id/supervisors",
    requiresPermission("housekeeping.assign"),
    asyncHandler(controller.setSupervisors)
  );

  // Room types
  router.get("/room-types", requiresPermission("hotel_rooms.view"), asyncHandler(controller.roomTypes));
  router.post("/room-types", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.createRoomType));
  router.patch("/room-types/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.updateRoomType));
  router.delete("/room-types/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.removeRoomType));

  // Habitaciones
  router.get("/rooms", requiresPermission("hotel_rooms.view"), asyncHandler(controller.listRooms));
  router.post("/rooms", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.createRoom));
  router.patch("/rooms/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.updateRoom));
  router.delete("/rooms/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.removeRoom));
  router.patch(
    "/rooms/:id/status",
    requiresAnyPermission(["hotel_rooms.status", "housekeeping.inspect"]),
    asyncHandler(controller.changeStatus)
  );
  router.get("/rooms/:id/history", requiresPermission("hotel_rooms.view"), asyncHandler(controller.history));

  // Catalog: transition matrix (editable without code changes).
  router.get("/room-status-transitions", requiresPermission("hotel_rooms.view"), asyncHandler(controller.statusTransitions));
  router.post("/room-status-transitions", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.createStatusTransition));
  router.patch("/room-status-transitions/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.updateStatusTransition));
  router.delete("/room-status-transitions/:id", requiresPermission("hotel_rooms.manage"), asyncHandler(controller.removeStatusTransition));

  // Reasons catalog (adjustments, write-offs, room status, PO close, inspection).
  router.get("/reasons", requiresPermission("hotel_rooms.view"), asyncHandler(controller.reasons));
  router.post("/reasons", requiresPermission("hotel_store.manage"), asyncHandler(controller.createReason));
  router.patch("/reasons/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.updateReason));
  router.delete("/reasons/:id", requiresPermission("hotel_store.manage"), asyncHandler(controller.removeReason));

  // Board by zone, already filtered by scope.
  router.get("/rooms/board", requiresPermission("hotel_rooms.view"), asyncHandler(controller.board));

  return router;
};
