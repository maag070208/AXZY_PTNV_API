import { Request, Response } from "express";
import { parseTableParams, paginatedTable, type TableFilters } from "@core/utils/table";
import { MaterialOutputService } from "../services/material-output.service";
import {
  MaterialOutputBatchInputSchema,
  MaterialOutputInputSchema,
  MaterialOutputUpdateInputSchema,
} from "../models/dto/material-output.dto";

export class MaterialOutputController {
  constructor(private readonly materialOutputService: MaterialOutputService) {}

  /** Query string → filtros de tabla (texto): mismos filtros que `/query`. */
  private parseFilters(req: Request): TableFilters {
    const filters: TableFilters = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string" && value !== "") filters[key] = value;
    }
    return filters;
  }

  list = async (req: Request, res: Response) => {
    const data = await this.materialOutputService.list(this.parseFilters(req));
    res.json({ data, total: data.length });
  };

  /** Todo lo filtrado, sin paginar (PDF): mismo body y filtros que `/query`. */
  exportAll = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const data = await this.materialOutputService.list(params.filters);
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

  filterOptions = async (_req: Request, res: Response) => {
    res.json(await this.materialOutputService.filterOptions());
  };

  suggestions = async (_req: Request, res: Response) => {
    const data = await this.materialOutputService.suggestions();
    res.json(data);
  };
}