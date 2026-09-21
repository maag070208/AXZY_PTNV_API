import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { InventarioService } from "../services/inventario.service";
import {
  CreateDevolucionSchema,
  CreateDispositivoSchema,
  CreateMovimientoSchema,
  CreatePrestamoSchema,
  CreateTipoDispositivoSchema,
  UpdateDispositivoSchema,
  UpdatePrestamoSchema,
  UpdateTipoDispositivoSchema,
  UpdateUnidadSchema,
} from "../models/dto/inventario.dto";

export class InventarioController {
  constructor(private readonly service: InventarioService) {}

  // Tipos
  listTipos = async (_req: Request, res: Response) => {
    res.json(await this.service.listTipos());
  };

  createTipo = async (req: Request, res: Response) => {
    const input = CreateTipoDispositivoSchema.parse(req.body);
    res.status(201).json(await this.service.createTipo(input));
  };

  updateTipo = async (req: Request, res: Response) => {
    const input = UpdateTipoDispositivoSchema.parse(req.body);
    res.json(await this.service.updateTipo(req.params.id, input));
  };

  deleteTipo = async (req: Request, res: Response) => {
    res.json(await this.service.deleteTipo(req.params.id));
  };

  // Dispositivos
  listDispositivos = async (req: Request, res: Response) => {
    const { tipoId, q, existencias } = req.query;
    const filters = {
      tipoId: typeof tipoId === "string" ? tipoId : undefined,
      q: typeof q === "string" ? q : undefined,
    };
    const data =
      existencias === "true"
        ? await this.service.listDispositivosConExistencias(filters)
        : await this.service.listDispositivos(filters);
    res.json(data);
  };

  getDispositivo = async (req: Request, res: Response) => {
    const data = await this.service.getDispositivo(req.params.id);
    if (!data) throw new HttpError(404, "Dispositivo no encontrado");
    res.json(data);
  };

  createDispositivo = async (req: Request, res: Response) => {
    const input = CreateDispositivoSchema.parse(req.body);
    const data = await this.service.createDispositivo(input, req.user?.id);
    res.status(201).json(data);
  };

  updateDispositivo = async (req: Request, res: Response) => {
    const input = UpdateDispositivoSchema.parse(req.body);
    res.json(await this.service.updateDispositivo(req.params.id, input));
  };

  deleteDispositivo = async (req: Request, res: Response) => {
    res.json(await this.service.deleteDispositivo(req.params.id));
  };

  existencias = async (req: Request, res: Response) => {
    res.json(await this.service.existencias(req.params.id));
  };

  unidades = async (req: Request, res: Response) => {
    res.json(await this.service.unidades(req.params.id));
  };

  updateUnidad = async (req: Request, res: Response) => {
    const input = UpdateUnidadSchema.parse(req.body);
    res.json(await this.service.updateUnidad(req.params.id, input));
  };

  kardex = async (req: Request, res: Response) => {
    res.json(await this.service.kardex(req.params.id));
  };

  // Movimientos
  listMovimientos = async (req: Request, res: Response) => {
    const { tipo, dispositivoId } = req.query;
    res.json(
      await this.service.listMovimientos({
        tipo: typeof tipo === "string" ? tipo : undefined,
        dispositivoId: typeof dispositivoId === "string" ? dispositivoId : undefined,
      })
    );
  };

  getMovimiento = async (req: Request, res: Response) => {
    const data = await this.service.getMovimiento(req.params.id);
    if (!data) throw new HttpError(404, "Movimiento no encontrado");
    res.json(data);
  };

  registerMovimiento = async (req: Request, res: Response) => {
    const input = CreateMovimientoSchema.parse(req.body);
    const data = await this.service.registerMovimiento(input, req.user?.id);
    res.status(201).json(data);
  };

  revertir = async (req: Request, res: Response) => {
    const data = await this.service.registerMovimiento(
      { tipo: "REVERSION", movimientoId: req.params.id, detalles: [] },
      req.user?.id
    );
    res.status(201).json(data);
  };

  // Préstamos
  listPrestamos = async (req: Request, res: Response) => {
    const { status, responsableId } = req.query;
    res.json(
      await this.service.listPrestamos({
        status: typeof status === "string" ? status : undefined,
        responsableId: typeof responsableId === "string" ? responsableId : undefined,
      })
    );
  };

  getPrestamo = async (req: Request, res: Response) => {
    const data = await this.service.getPrestamo(req.params.id);
    if (!data) throw new HttpError(404, "Préstamo no encontrado");
    res.json(data);
  };

  createPrestamo = async (req: Request, res: Response) => {
    const input = CreatePrestamoSchema.parse(req.body);
    const data = await this.service.registerMovimiento(
      {
        tipo: "PRESTAMO",
        responsableId: input.responsableId,
        departamentoId: input.departamentoId,
        subareaId: input.subareaId,
        observaciones: input.observaciones,
        detalles: input.detalles,
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  cancelarPrestamo = async (req: Request, res: Response) => {
    res.json(await this.service.cancelarPrestamo(req.params.id));
  };

  updatePrestamo = async (req: Request, res: Response) => {
    const input = UpdatePrestamoSchema.parse(req.body);
    res.json(await this.service.updatePrestamo(req.params.id, input));
  };

  // Devoluciones
  listDevoluciones = async (req: Request, res: Response) => {
    const { prestamoId } = req.query;
    res.json(
      await this.service.listDevoluciones({
        prestamoId: typeof prestamoId === "string" ? prestamoId : undefined,
      })
    );
  };

  createDevolucion = async (req: Request, res: Response) => {
    const input = CreateDevolucionSchema.parse(req.body);
    const data = await this.service.registerMovimiento(
      {
        tipo: "DEVOLUCION",
        prestamoId: input.prestamoId,
        responsableId: input.responsableId,
        observaciones: input.observaciones,
        detalles: input.detalles as unknown as import("../models/entity/inventario.entity").MovimientoDetalleInput[],
      },
      req.user?.id
    );
    res.status(201).json(data);
  };

  dashboard = async (_req: Request, res: Response) => {
    res.json(await this.service.dashboard());
  };
}