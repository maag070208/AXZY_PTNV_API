import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { SalidaService } from "../services/salida.service";
import {
  MaterialOutputBatchInputSchema,
  MaterialOutputInputSchema,
  MaterialOutputUpdateInputSchema,
} from "../models/dto/material-output.dto";

export class SalidaController {
  constructor(private readonly salidaService: SalidaService) {}

  private parseFilters(req: Request) {
    return {
      start: typeof req.query.start === "string" ? req.query.start : undefined,
      end: typeof req.query.end === "string" ? req.query.end : undefined,
      departamento: typeof req.query.departamento === "string" ? req.query.departamento : undefined,
      usuario: typeof req.query.usuario === "string" ? req.query.usuario : undefined,
      area: typeof req.query.area === "string" ? req.query.area : undefined,
      proyecto: typeof req.query.proyecto === "string" ? req.query.proyecto : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    };
  }

  list = async (req: Request, res: Response) => {
    const data = await this.salidaService.list(this.parseFilters(req));
    res.json({ data, total: data.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.salidaService.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.salidaService.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = MaterialOutputInputSchema.parse(req.body);
    const data = await this.salidaService.create(input, req.user?.id);
    res.status(201).json(data);
  };

  createBatch = async (req: Request, res: Response) => {
    const input = MaterialOutputBatchInputSchema.parse(req.body);
    const data = await this.salidaService.createBatch(input.rows, req.user?.id);
    res.status(201).json({ data, total: data.length });
  };

  update = async (req: Request, res: Response) => {
    const input = MaterialOutputUpdateInputSchema.parse(req.body);
    const data = await this.salidaService.update(req.params.id, input);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.salidaService.remove(req.params.id);
    res.json(data);
  };

  suggestions = async (_req: Request, res: Response) => {
    const data = await this.salidaService.suggestions();
    res.json(data);
  };
}