import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./salida.service";

const rowSchema = z.object({
  fecha: z.string().optional(),
  descripcion: z.string().min(1),
  modelo: z.string().optional(),
  marca: z.string().optional(),
  proyecto: z.string().optional(),
  cantidad: z.number().int().min(1).optional(),
  departamento: z.string().min(1),
  usuario: z.string().min(1),
  observaciones: z.string().optional(),
  area: z.string().optional(),
  deviceId: z.string().optional(),
});

const batchSchema = z.object({
  rows: z.array(rowSchema).min(1).max(200),
});

const updateSchema = rowSchema.partial();

const parseFilters = (req: Request): service.MaterialOutputFilters => ({
  start: typeof req.query.start === "string" ? req.query.start : undefined,
  end: typeof req.query.end === "string" ? req.query.end : undefined,
  departamento:
    typeof req.query.departamento === "string" ? req.query.departamento : undefined,
  usuario: typeof req.query.usuario === "string" ? req.query.usuario : undefined,
  area: typeof req.query.area === "string" ? req.query.area : undefined,
  proyecto: typeof req.query.proyecto === "string" ? req.query.proyecto : undefined,
  q: typeof req.query.q === "string" ? req.query.q : undefined,
});

export const list = async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const data = await service.listMaterialOutputs(filters);
  res.json({ data, total: data.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listMaterialOutputsTable(params);
  res.json({ data, total });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getMaterialOutput(req.params.id);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = rowSchema.parse(req.body);
  const data = await service.createMaterialOutput(input, req.user?.id);
  res.status(201).json(data);
};

export const createBatch = async (req: Request, res: Response) => {
  const input = batchSchema.parse(req.body);
  const data = await service.createMaterialOutputsBatch(input.rows, req.user?.id);
  res.status(201).json({ data, total: data.length });
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateMaterialOutput(req.params.id, input);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteMaterialOutput(req.params.id);
  res.json(data);
};

export const suggestions = async (_req: Request, res: Response) => {
  const data = await service.getSuggestions();
  res.json(data);
};
