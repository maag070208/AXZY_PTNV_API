import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { firstSheetHeaders, hasColumn, parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
import { DeviceHistoryService } from "../services/device-history.service";
import { DeviceLoteService } from "../services/device-lote.service";
import { DeviceService } from "../services/device.service";
import {
  AddUnitsInputSchema,
  DeviceBatchInputSchema,
  DeviceHistoryInputSchema,
  DeviceInputSchema,
  DeviceUpdateInputSchema,
  LoteUpdateInputSchema,
} from "../models/dto/device.dto";

export class DeviceController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly deviceLoteService: DeviceLoteService,
    private readonly deviceHistoryService: DeviceHistoryService
  ) {}

  list = async (req: Request, res: Response) => {
    const data = await this.deviceService.list({
      typeId: typeof req.query.typeId === "string" ? req.query.typeId : undefined,
      estado: typeof req.query.estado === "string" ? req.query.estado : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });
    res.json({ data, total: data.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.deviceService.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.deviceService.getById(req.params.id);
    res.json(data);
  };

  getHistory = async (req: Request, res: Response) => {
    const data = await this.deviceHistoryService.getHistory(req.params.id);
    res.json(data);
  };

  addHistory = async (req: Request, res: Response) => {
    const input = DeviceHistoryInputSchema.parse(req.body);
    const data = await this.deviceHistoryService.add(
      req.params.id,
      input.type,
      input.detail,
      req.user?.id
    );
    res.status(201).json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = DeviceInputSchema.parse(req.body);
    const data = await this.deviceService.create(input, req.user?.id);
    res.status(201).json(data);
  };

  createBatch = async (req: Request, res: Response) => {
    const input = DeviceBatchInputSchema.parse(req.body);
    const data = await this.deviceService.createBatch(input, req.user?.id);
    res.status(201).json({ data, total: data.length });
  };

  // Carga masiva desde Excel: solo lee el archivo y regresa las filas (modelo,
  // descripcion, cantidad) para que el usuario las revise/edite antes de
  // confirmar la alta real via createBatch (no crea nada aqui).
  parseImportFile = async (req: Request, res: Response) => {
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

  update = async (req: Request, res: Response) => {
    const input = DeviceUpdateInputSchema.parse(req.body);
    const data = await this.deviceService.update(req.params.id, input, req.user?.id);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const force = req.query.force === "true" || req.body?.force === true;
    const data = await this.deviceService.remove(req.params.id, req.user?.id, force);
    res.json(data);
  };

  summary = async (_req: Request, res: Response) => {
    const data = await this.deviceService.summary();
    res.json(data);
  };

  getLote = async (req: Request, res: Response) => {
    const data = await this.deviceLoteService.listByLote(req.params.loteId);
    res.json({ data, total: data.length });
  };

  addUnits = async (req: Request, res: Response) => {
    const input = AddUnitsInputSchema.parse(req.body);
    const result = await this.deviceLoteService.addUnits(req.params.id, input.cantidad, req.user?.id);
    res.status(201).json({
      loteId: result.loteId,
      data: result.created,
      total: result.created.length,
    });
  };

  updateLote = async (req: Request, res: Response) => {
    const input = LoteUpdateInputSchema.parse(req.body);
    const data = await this.deviceLoteService.updateLote(
      req.params.loteId,
      {
        typeId: input.typeId,
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
}