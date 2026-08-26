import { Request, Response } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import {
  listMovements,
  getKardexByDevice,
  registerMovement,
  getInventorySummary,
} from "./inventory.service";

export const listMovementsCtrl = asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, locationId, start, end } = req.query as Record<string, string>;
  const movements = await listMovements({ deviceId, locationId, start, end });
  res.json(movements);
});

export const getKardexCtrl = asyncHandler(async (req: Request, res: Response) => {
  const kardex = await getKardexByDevice(req.params.deviceId);
  res.json(kardex);
});

export const registerMovementCtrl = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) throw new Error("User ID not found in request");

  const movement = await registerMovement({
    ...req.body,
    userId,
  });
  res.status(201).json(movement);
});

export const getInventorySummaryCtrl = asyncHandler(async (_req: Request, res: Response) => {
  const summary = await getInventorySummary();
  res.json(summary);
});
