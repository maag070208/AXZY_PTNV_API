import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./device.service";

const itSpecsShape = {
  ip: z.string().optional(),
  macAddress: z.string().optional(),
  sistemaOp: z.string().optional(),
  ram: z.string().optional(),
  almacenamiento: z.string().optional(),
};

const createSchema = z.object({
  typeId: z.string().min(1),
  descripcion: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  numeroSerie: z.string().optional(),
  nombreEquipo: z.string().optional(),
  area: z.string().optional(),
  estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]).optional(),
  ...itSpecsShape,
});

const updateSchema = createSchema.partial();

// Alta por lote: N unidades del mismo tipo/marca/modelo, cada una con sus
// propios identificadores únicos (serie, nombre de equipo, IP, MAC).
const batchUnitSchema = z.object({
  numeroSerie: z.string().optional(),
  nombreEquipo: z.string().optional(),
  ip: z.string().optional(),
  macAddress: z.string().optional(),
});

const createBatchSchema = z.object({
  typeId: z.string().min(1),
  descripcion: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  area: z.string().optional(),
  estado: z.enum(["DISPONIBLE", "ASIGNADO", "BAJA"]).optional(),
  sistemaOp: z.string().optional(),
  ram: z.string().optional(),
  almacenamiento: z.string().optional(),
  units: z.array(batchUnitSchema).min(1).max(500),
});

const historySchema = z.object({
  type: z.string().min(1),
  detail: z.string().optional(),
});

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

export const getHistory = async (req: Request, res: Response) => {
  const data = await service.getDeviceHistory(req.params.id);
  res.json(data);
};

export const addHistory = async (req: Request, res: Response) => {
  const input = historySchema.parse(req.body);
  const data = await service.addDeviceHistory(
    req.params.id,
    input.type,
    input.detail,
    req.user?.id
  );
  res.status(201).json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createDevice(input, req.user?.id);
  res.status(201).json(data);
};

export const createBatch = async (req: Request, res: Response) => {
  const input = createBatchSchema.parse(req.body);
  const data = await service.createDevicesBatch(input, req.user?.id);
  res.status(201).json({ data, total: data.length });
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateDevice(req.params.id, input, req.user?.id);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteDevice(req.params.id, req.user?.id);
  res.json(data);
};
const loteUnitSchema = z.object({
  id: z.string().min(1),
  numeroSerie: z.string().optional(),
  nombreEquipo: z.string().optional(),
  ip: z.string().optional(),
  macAddress: z.string().optional(),
  area: z.string().optional(),
});

const loteUpdateSchema = z.object({
  descripcion: z.string().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  sistemaOp: z.string().optional(),
  ram: z.string().optional(),
  almacenamiento: z.string().optional(),
  units: z.array(loteUnitSchema).default([]),
});

export const summary = async (_req: Request, res: Response) => {
  const data = await service.getDevicesSummary();
  res.json(data);
};

export const getLote = async (req: Request, res: Response) => {
  const data = await service.listDevicesByLote(req.params.loteId);
  res.json({ data, total: data.length });
};

export const updateLote = async (req: Request, res: Response) => {
  const input = loteUpdateSchema.parse(req.body);
  const data = await service.updateDevicesLote(
    req.params.loteId,
    {
      descripcion: input.descripcion,
      marca: input.marca,
      modelo: input.modelo,
      sistemaOp: input.sistemaOp,
      ram: input.ram,
      almacenamiento: input.almacenamiento,
    },
    input.units,
    req.user?.id
  );
  res.json({ data, total: data.length });
};
