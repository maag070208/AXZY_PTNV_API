import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { AccessService } from "../services/access.service";
import { AccessReportService } from "../services/access-report.service";
import {
  AccessEventCreateSchema,
  AccessEventVoidDto,
  AccessLookupDto,
  SiteCreateDto,
  SiteUpdateDto,
} from "../models/dto/access.dto";
import type { AccessActor } from "../models/entity/access.entity";

const actorOf = (req: Request): AccessActor => {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
  return { id: req.user.id, name: req.user.username };
};

/**
 * Coacciona el `limit` numérico a `number` (acepta un string numérico, p. ej.
 * `"1000"`) y lo clampa a 100 antes de `parseTableParams`: el schema compartido
 * descarta TODO el body cuando `limit` no es número o excede 100, y el reporte
 * necesita conservar `filters.period/date` para acotar la ventana.
 */
const coerceLimit = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const parseReportParams = (body: unknown) => {
  const raw = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  const limit = coerceLimit(raw.limit);
  if (limit !== undefined) raw.limit = Math.min(limit, 100);
  return parseTableParams(raw);
};

export class AccessController {
  constructor(
    private readonly service: AccessService,
    private readonly reportService: AccessReportService
  ) {}

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

  stats = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    res.json(await this.service.stats(params));
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
    const tz = typeof req.query.tz === "string" && req.query.tz !== "" ? req.query.tz : undefined;
    const data = await this.service.meToday(actor.id, tz);
    res.json({ data, total: data.length });
  };

  report = async (req: Request, res: Response): Promise<void> => {
    const params = parseReportParams(req.body);
    res.json(await this.reportService.report(params));
  };

  reportExport = async (req: Request, res: Response): Promise<void> => {
    const params = parseReportParams(req.body);
    res.json(await this.reportService.reportExport(params));
  };
}
