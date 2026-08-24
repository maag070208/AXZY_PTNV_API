import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./device-type.service";

const createSchema = z.object({
  code: z.string().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1),
  prefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, "Prefijo solo letras/números"),
});

const updateSchema = z.object({
  name: z.string().optional(),
  prefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/)
    .optional(),
  active: z.boolean().optional(),
});

export const list = async (req: Request, res: Response) => {
  const include = req.query.includeInactive === "true";
  const data = await service.listDeviceTypes(include);
  res.json(data);
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listDeviceTypesTable(params);
  res.json({ data, total });
};

export const peek = async (req: Request, res: Response) => {
  const next = await service.peekNextControlActivo(req.params.id);
  res.json({ siguiente: next });
};

export const peekCarta = async (req: Request, res: Response) => {
  const next = await service.peekNextCartaFolio(req.params.id);
  res.json({ siguiente: next });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getDeviceType(req.params.id);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createDeviceType(input);
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateDeviceType(req.params.id, input);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteDeviceType(req.params.id);
  res.json(data);
};