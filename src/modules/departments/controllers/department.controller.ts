import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  DepartmentCreateDto,
  DepartmentUpdateDto,
  SubareaCreateDto,
  DepartmentLocationCreateDto,
} from "../models/dto/department.dto";
import { DepartmentService } from "../services/department.service";
import { SubareaService } from "../services/subarea.service";

export class DepartmentController {
  constructor(
    private readonly departments: DepartmentService,
    private readonly subareas: SubareaService
  ) {}

  list = async (req: Request, res: Response) => {
    const include = req.query.includeInactive === "true";
    const data = await this.departments.list(include);
    res.json(data);
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.departments.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.departments.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = DepartmentCreateDto.parse(req.body);
    const data = await this.departments.create(input);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const input = DepartmentUpdateDto.parse(req.body);
    const data = await this.departments.update(req.params.id, input);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.departments.remove(req.params.id);
    res.json(data);
  };

  addSubarea = async (req: Request, res: Response) => {
    const input = SubareaCreateDto.parse(req.body);
    const data = await this.subareas.create(req.params.id, input);
    res.status(201).json(data);
  };

  removeSubarea = async (req: Request, res: Response) => {
    const data = await this.subareas.remove(req.params.id);
    res.json(data);
  };

  addLocation = async (req: Request, res: Response) => {
    const input = DepartmentLocationCreateDto.parse(req.body);
    const data = await this.departments.addLocation(req.params.id, input.locationId);
    res.status(201).json(data);
  };

  removeLocation = async (req: Request, res: Response) => {
    const data = await this.departments.removeLocation(req.params.id, req.params.locationId);
    res.json(data);
  };
}