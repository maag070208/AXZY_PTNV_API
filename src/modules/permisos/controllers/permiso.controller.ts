import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { PermisoService } from "../services/permiso.service";
import {
  parseCatalogoCreateBody,
  parseCatalogoUpdateBody,
  parseMatrizBody,
} from "../models/dto/permiso.dto";

export class PermisoController {
  constructor(private readonly svc: PermisoService) {}

  admin = async (_req: Request, res: Response) => {
    res.json(await this.svc.adminData());
  };

  catalogo = async (_req: Request, res: Response) => {
    res.json(await this.svc.getCatalogoActivo());
  };

  create = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const dto = parseCatalogoCreateBody(req.body);
    const data = await this.svc.createCatalogo(dto, req.user.id);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const { clave } = req.params;
    const dto = parseCatalogoUpdateBody(req.body);
    const data = await this.svc.updateCatalogo(clave, dto, req.user.id);
    res.json(data);
  };

  matriz = async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, "No autenticado");
    const { cambios } = parseMatrizBody(req.body);
    const data = await this.svc.saveMatriz(cambios, req.user.id);
    res.json(data);
  };

  reload = async (_req: Request, res: Response) => {
    await this.svc.reload();
    res.json({ ok: true });
  };
}
