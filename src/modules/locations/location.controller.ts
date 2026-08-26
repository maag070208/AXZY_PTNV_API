import { Request, Response } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import {
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
} from "./location.service";

export const listLocationsCtrl = asyncHandler(async (_req: Request, res: Response) => {
  const locations = await listLocations();
  res.json(locations);
});

export const getLocationCtrl = asyncHandler(async (req: Request, res: Response) => {
  const loc = await getLocation(req.params.id);
  res.json(loc);
});

export const createLocationCtrl = asyncHandler(async (req: Request, res: Response) => {
  const loc = await createLocation(req.body);
  res.status(201).json(loc);
});

export const updateLocationCtrl = asyncHandler(async (req: Request, res: Response) => {
  const loc = await updateLocation(req.params.id, req.body);
  res.json(loc);
});

export const deleteLocationCtrl = asyncHandler(async (req: Request, res: Response) => {
  await deleteLocation(req.params.id);
  res.json({ success: true });
});
