import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { PermissionService } from "../services/permission.service";
import {
  parseCatalogCreateBody,
  parseCatalogUpdateBody,
  parseMatrixBody,
} from "../models/dto/permission.dto";

export class PermissionController {
  constructor(private readonly svc: PermissionService) {}

  admin = async (_req: Request, res: Response) => {
    res.json(await this.svc.adminData());
  };

  catalog = async (_req: Request, res: Response) => {
    res.json(await this.svc.getActiveCatalog());
  };

  create = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const dto = parseCatalogCreateBody(req.body);
    const data = await this.svc.createCatalog(dto, req.user.id);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const { key } = req.params;
    const dto = parseCatalogUpdateBody(req.body);
    const data = await this.svc.updateCatalog(key, dto, req.user.id);
    res.json(data);
  };

  matrix = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const { changes } = parseMatrixBody(req.body);
    const data = await this.svc.saveMatrix(changes, req.user.id);
    res.json(data);
  };

  reload = async (_req: Request, res: Response) => {
    await this.svc.reload();
    res.json({ ok: true });
  };
}
