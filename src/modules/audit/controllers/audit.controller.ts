import { Request, Response } from "express";
import { AuditService } from "../services/audit.service";

export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  list = async (req: Request, res: Response) => {
    const data = await this.auditService.list({
      action: typeof req.query.action === "string" ? req.query.action : undefined,
      entityType: typeof req.query.entityType === "string" ? req.query.entityType : undefined,
      userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
      deviceId: typeof req.query.deviceId === "string" ? req.query.deviceId : undefined,
      start: typeof req.query.start === "string" ? req.query.start : undefined,
      end: typeof req.query.end === "string" ? req.query.end : undefined,
      page: req.query.page && !Number.isNaN(Number(req.query.page)) ? Number(req.query.page) : undefined,
      limit: req.query.limit && !Number.isNaN(Number(req.query.limit)) ? Number(req.query.limit) : undefined,
    });
    res.json(data);
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.auditService.getById(req.params.id);
    res.json(data);
  };
}