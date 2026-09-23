import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { AccessService } from "../services/access.service";
import {
  AccessEventCreateSchema,
  AccessEventVoidDto,
  AccessLookupDto,
  SiteCreateDto,
  SiteUpdateDto,
} from "../models/dto/access.dto";
import type { AccessActor } from "../models/entity/access.entity";

const actorOf = (req: Request): AccessActor => {
  if (!req.user) throw new HttpError(401, "No autenticado");
  return { id: req.user.id, name: req.user.username };
};

export class AccessController {
  constructor(private readonly service: AccessService) {}

  lookup = async (req: Request, res: Response): Promise<void> => {
    const { qr } = AccessLookupDto.parse(req.body);
    res.json(await this.service.lookup(qr));
  };

  createEvent = async (req: Request, res: Response): Promise<void> => {
    const input = AccessEventCreateSchema.parse(req.body);
    const { event, created } = await this.service.createEvent(input, actorOf(req));
    res.status(created ? 201 : 200).json(event);
  };

  status = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.status(req.params.employeeId));
  };

  table = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.getById(req.params.id));
  };

  voidEvent = async (req: Request, res: Response): Promise<void> => {
    const { reason } = AccessEventVoidDto.parse(req.body);
    const { event } = await this.service.voidEvent(req.params.id, reason, actorOf(req));
    res.json(event);
  };

  sites = async (req: Request, res: Response): Promise<void> => {
    const includeInactive =
      req.query.includeInactive === "true" && req.user?.role === "ADMIN";
    res.json(await this.service.sites(includeInactive));
  };

  createSite = async (req: Request, res: Response): Promise<void> => {
    const input = SiteCreateDto.parse(req.body);
    res.status(201).json(await this.service.createSite(input, actorOf(req)));
  };

  updateSite = async (req: Request, res: Response): Promise<void> => {
    const input = SiteUpdateDto.parse(req.body);
    res.json(await this.service.updateSite(req.params.id, input, actorOf(req)));
  };

  meToday = async (req: Request, res: Response): Promise<void> => {
    const actor = actorOf(req);
    const data = await this.service.meToday(actor.id);
    res.json({ data, total: data.length });
  };
}
