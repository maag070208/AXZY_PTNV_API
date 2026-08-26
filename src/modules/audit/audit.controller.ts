import { Request, Response } from "express";
import { asyncHandler } from "@core/utils/asyncHandler";
import * as service from "./audit.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { action, entityType, userId, deviceId, start, end, page, limit } = req.query as Record<string, string>;

  const result = await service.listAuditLogs({
    action,
    entityType,
    userId,
    deviceId,
    start,
    end,
    page: page ? parseInt(page) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  });

  res.json(result);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const log = await service.getAuditLogById(req.params.id);
  res.json(log);
});
