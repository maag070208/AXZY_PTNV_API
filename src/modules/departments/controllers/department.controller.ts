import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { DepartmentCreateDto, DepartmentUpdateDto } from "../models/dto/department.dto";
import { DepartmentService } from "../services/department.service";

export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

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
}
