import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
import * as service from "./material.service";

const createSchema = z.object({
  categoria: z.string().min(1),
  modelo: z.string().min(1),
  descripcion: z.string().min(1),
  marca: z.string().optional(),
  stock: z.number().int().min(0).optional(),
  unidad: z.string().optional(),
});

const updateSchema = z.object({
  categoria: z.string().min(1).optional(),
  modelo: z.string().min(1).optional(),
  descripcion: z.string().min(1).optional(),
  marca: z.string().optional(),
  stock: z.number().int().min(0).optional(),
  unidad: z.string().optional(),
  active: z.boolean().optional(),
});

export const list = async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  const data = await service.listMaterials(includeInactive);
  res.json(data);
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listMaterialsTable(params);
  res.json({ data, total });
};

export const summary = async (_req: Request, res: Response) => {
  const data = await service.getMaterialsSummary();
  res.json(data);
};

export const categorias = async (_req: Request, res: Response) => {
  const data = await service.listCategorias();
  res.json(data);
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getMaterial(req.params.id);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createMaterial(input, req.user?.id);
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateMaterial(req.params.id, input, req.user?.id);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteMaterial(req.params.id);
  res.json(data);
};

export const importMaterials = async (req: Request, res: Response) => {
  if (!req.file) throw new HttpError(400, "Falta el archivo Excel (.xlsx)");
  const categoria = String(req.body.categoria ?? "").trim();
  if (!categoria) throw new HttpError(400, "Falta la categoría para esta carga");

  const rawRows = parseFirstSheet(req.file.buffer);
  const rows = rawRows.map((r) => ({
    modelo: pickColumn(r, ["MODELO"]),
    descripcion: pickColumn(r, ["DESCRIPCION", "DESCRIPCIÓN"]),
    cantidad: Number(pickColumn(r, ["CANTIDAD"])) || 0,
  }));

  const data = await service.importMaterials(rows, categoria, req.user?.id);
  res.status(201).json(data);
};
