import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { TimeClockService } from "../services/time-clock.service";
import { TimeClockEmployeesService } from "../services/time-clock-employees.service";
import { TimeClockReportService } from "../services/time-clock-report.service";
import { TimeClockRosterService } from "../services/time-clock-roster.service";
import { TimeClockInspectService } from "../services/time-clock-inspect.service";
import { TimeClockPeopleService } from "../services/time-clock-people.service";
import { TimeClockSummaryService } from "../services/time-clock-summary.service";
import { ClockCardDto, ClockPersonCreateDto, ClockPersonUpdateDto } from "../models/dto/time-clock.dto";
import { RemovalCategoryDto, RemovalCategoryUpdateDto, TimeClockRosterRemovalDto } from "../models/dto/time-clock.dto";
import {
  TimeClockImportDto,
  TimeClockDto,
  TimeClockUpdateDto,
  TimeClockLinkDto,
} from "../models/dto/time-clock.dto";

/**
 * Como en `/access/report`: el export pide `limit` 1000 y el schema compartido
 * de tablas descarta TODO el body si `limit` excede 100 (se perderían
 * `period/date`), así que se clampa antes de `parseTableParams`.
 */
const parseReportParams = (body: unknown) => {
  const raw = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  const limit = Number(raw.limit);
  if (raw.limit !== undefined && Number.isFinite(limit)) raw.limit = Math.min(limit, 100);
  return parseTableParams(raw);
};

export class TimeClockController {
  constructor(
    private readonly service: TimeClockService,
    private readonly report: TimeClockReportService,
    private readonly employees: TimeClockEmployeesService,
    private readonly rosterService: TimeClockRosterService,
    private readonly inspect: TimeClockInspectService,
    private readonly people: TimeClockPeopleService,
    private readonly summaryService: TimeClockSummaryService
  ) {}

  summary = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.summaryService.summary());
  };

  peopleList = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.people.list(req.params.serial));
  };

  peopleCreate = async (req: Request, res: Response): Promise<void> => {
    const input = ClockPersonCreateDto.parse(req.body);
    res.status(201).json(await this.people.create(req.params.serial, input, req.user!.id));
  };

  personDetail = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.people.detail(req.params.serial, req.params.employeeNo));
  };

  personPhoto = async (req: Request, res: Response): Promise<void> => {
    const bytes = await this.people.photo(req.params.serial, req.params.employeeNo);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, no-store");
    res.end(bytes);
  };

  peopleRename = async (req: Request, res: Response): Promise<void> => {
    const input = ClockPersonUpdateDto.parse(req.body);
    res.json(await this.people.rename(req.params.serial, req.params.employeeNo, input, req.user!.id));
  };

  peopleRemove = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.people.remove(req.params.serial, req.params.employeeNo, req.user!.id));
  };

  peopleAddCard = async (req: Request, res: Response): Promise<void> => {
    const { cardNo } = ClockCardDto.parse(req.body);
    res.status(201).json(await this.people.addCard(req.params.serial, req.params.employeeNo, cardNo, req.user!.id));
  };

  peopleRemoveCard = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.people.removeCard(req.params.serial, req.params.cardNo, req.user!.id));
  };

  inspectOverview = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.inspect.overview(req.params.serial));
  };

  inspectUsers = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.inspect.users(req.params.serial));
  };

  inspectCards = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.inspect.cards(req.params.serial));
  };

  inspectCamera = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.inspect.camera(req.params.serial));
  };

  inspectEvents = async (req: Request, res: Response): Promise<void> => {
    const days = Math.min(30, Math.max(1, Number(req.query.days ?? 2) || 2));
    res.json(await this.inspect.events(req.params.serial, days));
  };

  table = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.table(params);
    res.json(paginatedTable(params, data, total));
  };

  status = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.status());
  };

  /** 202: la importación sigue en segundo plano; su avance sale en `/status`. */
  startImport = async (req: Request, res: Response): Promise<void> => {
    const input = TimeClockImportDto.parse(req.body);
    res.status(202).json(await this.service.startImport(input));
  };

  /** 202: el drenado sigue en segundo plano; su avance sale en `/status`. */
  sync = async (_req: Request, res: Response): Promise<void> => {
    res.status(202).json(await this.service.sync());
  };

  /** 201: el reloj contestó y quedó dado de alta; su primera sincronización ya arrancó. */
  registerClock = async (req: Request, res: Response): Promise<void> => {
    const input = TimeClockDto.parse(req.body);
    res.status(201).json(await this.service.register(input, req.user?.id));
  };

  updateClock = async (req: Request, res: Response): Promise<void> => {
    const input = TimeClockUpdateDto.parse(req.body);
    res.json(await this.service.update(req.params.serial, input, req.user?.id));
  };

  retireClock = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.retire(req.params.serial, req.user?.id));
  };

  clockSettings = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.settings(req.params.serial));
  };

  /** Timeline de un reloj: sus últimos intentos (falló/conectó) y el resumen. */
  clockEvents = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.history(req.params.serial, Number(req.query.limit ?? 0)));
  };

  getReport = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.report.report(parseReportParams(req.body)));
  };

  reportExport = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.report.reportExport(parseReportParams(req.body)));
  };

  employeesTable = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total, summary } = await this.employees.table(params);
    res.json({ ...paginatedTable(params, data, total), summary });
  };

  linkEmployee = async (req: Request, res: Response): Promise<void> => {
    const { userId } = TimeClockLinkDto.parse(req.body);
    res.json(await this.employees.linkEmployee(req.params.number, userId, req.user?.id));
  };

  unlinkEmployee = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.employees.unlinkEmployee(req.params.number, req.user?.id));
  };

  roster = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.rosterService.list());
  };

  runRoster = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.rosterService.run("MANUAL"));
  };

  applyRemoval = async (req: Request, res: Response): Promise<void> => {
    const input = TimeClockRosterRemovalDto.parse(req.body);
    res.json(await this.rosterService.applyRemoval(req.params.number, req.user!.id, input));
  };

  listRemovalCategories = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.rosterService.listCategories(req.query.includeInactive === "true"));
  };

  createRemovalCategory = async (req: Request, res: Response): Promise<void> => {
    const input = RemovalCategoryDto.parse(req.body);
    res.status(201).json(await this.rosterService.createCategory(input, req.user!.id));
  };

  updateRemovalCategory = async (req: Request, res: Response): Promise<void> => {
    const input = RemovalCategoryUpdateDto.parse(req.body);
    res.json(await this.rosterService.updateCategory(req.params.id, input, req.user!.id));
  };

  dismissRemoval = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.rosterService.dismissRemoval(req.params.number, req.user!.id));
  };

  linkSuggested = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.employees.linkSuggested(req.user?.id));
  };
}
