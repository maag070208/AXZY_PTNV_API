import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { firstSheetHeaders, hasColumn, parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
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

// Carga masiva desde Excel: solo lee el archivo y regresa las filas (modelo,
// descripcion, cantidad) para que el usuario las revise/edite en el asistente
// antes de confirmar la alta real via createBatch (no crea nada aqui).
export const parseImportFile = async (req: Request, res: Response) => {
  if (!req.file) throw new HttpError(400, "Falta el archivo Excel (.xlsx)");
  const rawRows = parseFirstSheet(req.file.buffer);
  if (rawRows.length === 0) throw new HttpError(400, "El Excel está vacío o no contiene una primera hoja válida");
  const headerRow = Object.fromEntries(firstSheetHeaders(req.file.buffer).map((header) => [header, ""]));
  const missing = [
    !hasColumn(headerRow, "MODELO") ? "Modelo" : null,
    !hasColumn(headerRow, "DESCRIPCION") && !hasColumn(headerRow, "DESCRIPCIÓN") ? "Descripción" : null,
    !hasColumn(headerRow, "CANTIDAD") ? "Cantidad" : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) throw new HttpError(400, `Faltan columnas obligatorias: ${missing.join(", ")}. Revisa el schema de ejemplo.`);

  const errors: string[] = [];
  const rows = rawRows
    .map((r, index) => {
      const rowNumber = index + 2;
      const modelo = pickColumn(r, ["MODELO"]);
      const descripcion = pickColumn(r, ["DESCRIPCION", "DESCRIPCIÓN"]);
      const marca = pickColumn(r, ["MARCA", "BRAND"]);
      const tipo = pickColumn(r, ["TIPO", "TIPO DE DISPOSITIVO", "TYPE", "CODIGO", "CÓDIGO"]);
      const cantidad = Number(pickColumn(r, ["CANTIDAD"]));
      const rowErrors = [
        !modelo ? "falta Modelo" : null,
        !descripcion ? "falta Descripción" : null,
        !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500 ? "Cantidad debe ser un entero entre 1 y 500" : null,
      ].filter((value): value is string => Boolean(value));
      if (rowErrors.length > 0) {
        errors.push(`Fila ${rowNumber}: ${rowErrors.join("; ")}`);
        return null;
      }
      return { modelo, descripcion, cantidad, marca, tipo };
    })
    .filter((row): row is { modelo: string; descripcion: string; cantidad: number; marca: string; tipo: string } => row !== null);
  if (rows.length === 0) throw new HttpError(400, `No hay filas válidas para importar. ${errors.join(" | ")}`);
  res.json({ rows, errors });
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateDevice(req.params.id, input, req.user?.id);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const force = req.query.force === "true" || req.body?.force === true;
  const data = await service.deleteDevice(req.params.id, req.user?.id, force);
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

const addUnitsSchema = z.object({
  cantidad: z.number().int().min(1).max(500),
});

export const summary = async (_req: Request, res: Response) => {
  const data = await service.getDevicesSummary();
  res.json(data);
};

export const getLote = async (req: Request, res: Response) => {
  const data = await service.listDevicesByLote(req.params.loteId);
  res.json({ data, total: data.length });
};

export const addUnits = async (req: Request, res: Response) => {
  const input = addUnitsSchema.parse(req.body);
  const result = await service.addUnitsToDevice(
    req.params.id,
    input.cantidad,
    req.user?.id
  );
  res.status(201).json({
    loteId: result.loteId,
    data: result.created,
    total: result.created.length,
  });
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
