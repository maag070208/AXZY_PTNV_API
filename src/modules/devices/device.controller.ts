import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./device.service";

const createSchema = z.object({
  typeId: z.string().min(1),
  descripcion: z.string().min(1),
  cantidad: z.number().int().min(1).optional(),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  numeroSerie: z.string().optional(),
  nombreEquipo: z.string().optional(),
  area: z.string().optional(),
  estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]).optional(),
});

const updateSchema = createSchema.partial();

export const list = async (req: Request, res: Response) => {
  const data = await service.listDevices({
    typeId: typeof req.query.typeId === "string" ? req.query.typeId : undefined,
    estado: typeof req.query.estado === "string" ? req.query.estado : undefined,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
  });
  res.json({ data, total: data.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listDevicesTable(params);
  res.json({ data, total });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getDevice(req.params.id);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createDevice(input);
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateDevice(req.params.id, input);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteDevice(req.params.id);
  res.json(data);
};