import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { MaterialOutputService } from "../services/material-output.service";
import {
  MaterialOutputBatchInputSchema,
  MaterialOutputInputSchema,
  MaterialOutputUpdateInputSchema,
} from "../models/dto/material-output.dto";

export class MaterialOutputController {
  constructor(private readonly materialOutputService: MaterialOutputService) {}

  private parseFilters(req: Request) {
    return {
      start: typeof req.query.start === "string" ? req.query.start : undefined,
      end: typeof req.query.end === "string" ? req.query.end : undefined,
      departmentName: typeof req.query.departmentName === "string" ? req.query.departmentName : undefined,
      userName: typeof req.query.userName === "string" ? req.query.userName : undefined,
      area: typeof req.query.area === "string" ? req.query.area : undefined,
      project: typeof req.query.project === "string" ? req.query.project : undefined,
      reason: typeof req.query.reason === "string" ? (req.query.reason as any) : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    };
  }

  list = async (req: Request, res: Response) => {
    const data = await this.materialOutputService.list(this.parseFilters(req));
    res.json({ data, total: data.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.materialOutputService.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.materialOutputService.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = MaterialOutputInputSchema.parse(req.body);
    const data = await this.materialOutputService.create(input, req.user?.id);
    res.status(201).json(data);
  };

  createBatch = async (req: Request, res: Response) => {
    const input = MaterialOutputBatchInputSchema.parse(req.body);
    const data = await this.materialOutputService.createBatch(input.rows, req.user?.id);
    res.status(201).json({ data, total: data.length });
  };

  update = async (req: Request, res: Response) => {
    const input = MaterialOutputUpdateInputSchema.parse(req.body);
    const data = await this.materialOutputService.update(req.params.id, input, req.user?.id);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.materialOutputService.remove(req.params.id);
    res.json(data);
  };

  suggestions = async (_req: Request, res: Response) => {
    const data = await this.materialOutputService.suggestions();
    res.json(data);
  };
}