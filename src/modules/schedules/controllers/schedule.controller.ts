import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { ScheduleService } from "../services/schedule.service";
import { AssignmentCreateDto, AssignmentRemoveDto, ScheduleCreateDto, ScheduleUpdateDto } from "../models/dto/schedule.dto";

export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.service.list(includeInactive));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const input = ScheduleCreateDto.parse(req.body);
    res.status(201).json(await this.service.create(input));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const input = ScheduleUpdateDto.parse(req.body);
    res.json(await this.service.update(req.params.id, input));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.remove(req.params.id));
  };

  assign = async (req: Request, res: Response): Promise<void> => {
    const input = AssignmentCreateDto.parse(req.body);
    res.status(201).json(await this.service.assignBulk(input, req.user?.id));
  };

  removeAssignments = async (req: Request, res: Response): Promise<void> => {
    const input = AssignmentRemoveDto.parse(req.body);
    res.json(await this.service.removeBulk(input, req.user?.id));
  };

  assigned = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.scheduleAssignees(req.params.id));
  };

  assignmentsTable = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.assignmentsTable(params);
    res.json(paginatedTable(params, data, total));
  };

  overtime = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    res.json(await this.service.overtime(params));
  };

  overtimeExport = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    // El export de la pantalla única de tiempo extra muestra SOLO lo aprobado.
    res.json(await this.service.overtimeExport(params, true));
  };
}
