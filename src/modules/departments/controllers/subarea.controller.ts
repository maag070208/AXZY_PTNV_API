import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { SubareaCreateDto, SubareaUpdateDto } from "../models/dto/department.dto";
import { SubareaService } from "../services/subarea.service";

export class SubareaController {
  constructor(private readonly subareas: SubareaService) {}

  list = async (req: Request, res: Response) => {
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;
    const includeInactive = req.query.includeInactive === "true";
    const data = await this.subareas.list({ departmentId, includeInactive });
    res.json(data);
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.subareas.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.subareas.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = SubareaCreateDto.parse(req.body);
    const data = await this.subareas.create(input);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const input = SubareaUpdateDto.parse(req.body);
    const data = await this.subareas.update(req.params.id, input);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.subareas.remove(req.params.id);
    res.json(data);
  };
}
