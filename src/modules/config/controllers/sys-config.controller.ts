import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { SysConfigService } from "../services/sys-config.service";
import {
  assertSysConfigKey,
  parseSysConfigUpdateBody,
} from "../models/dto/sys-config.dto";

export class SysConfigController {
  constructor(private readonly svc: SysConfigService) {}

  list = async (_req: Request, res: Response) => {
    const data = await this.svc.list();
    res.json(data);
  };

  getOne = async (req: Request, res: Response) => {
    const { key } = req.params;
    assertSysConfigKey(key);
    const data = await this.svc.get(key);
    if (!data) throw new HttpError(404, "Configuración no encontrada");
    res.json(data);
  };

  upsert = async (req: Request, res: Response) => {
    const { key } = req.params;
    assertSysConfigKey(key);
    if (!req.user) throw new HttpError(401, "No autenticado");
    const { value, descripcion } = parseSysConfigUpdateBody(req.body);
    const data = await this.svc.upsert(key, value, descripcion, req.user.id);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const { key } = req.params;
    assertSysConfigKey(key);
    if (!req.user) throw new HttpError(401, "No autenticado");
    await this.svc.remove(key, req.user.id);
    res.status(204).end();
  };
}