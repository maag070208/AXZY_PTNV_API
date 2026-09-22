import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { broadcastDashboardEvent } from "@core/services/ably";
import type { AuditPort } from "../../audit/models/entity/audit.entity";
import type {
  Condicion,
  CreateDispositivoInput,
  CreateMovimientoInput,
  CreateTipoDispositivoInput,
  EstadoInventario,
  MovimientoDetalleInput,
  TipoMovimiento,
  UpdateDispositivoInput,
  UpdatePrestamoInput,
  UpdateTipoDispositivoInput,
  UpdateUnidadInput,
} from "../models/entity/inventario.entity";

type Tx = Prisma.TransactionClient;

const CONDICION_A_DISPONIBLE: Condicion[] = ["BUENO", "ACEPTABLE"];

const condicionToEstado = (condicion?: Condicion | null): EstadoInventario => {
  if (!condicion) return "DISPONIBLE";
  if (CONDICION_A_DISPONIBLE.includes(condicion)) return "DISPONIBLE";
  if (condicion === "ROTO") return "BAJA";
  return "DANADO";
};

const UNIDAD_SELECT = {
  id: true,
  activoFijo: true,
  numeroSerie: true,
  macAddress: true,
  ip: true,
  nombreEquipo: true,
  area: true,
  estado: true,
  departamentoId: true,
  dispositivoId: true,
} as const;

export class InventarioService {
  constructor(
    private readonly auditPort: AuditPort,
    private readonly db = prismaClient
  ) {}

  // ---------------------------------------------------------------------------
  // Tipos de dispositivo
  // ---------------------------------------------------------------------------
  listTipos() {
    return this.db.tipoDispositivo.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { dispositivos: true } } },
    });
  }

  async createTipo(input: CreateTipoDispositivoInput) {
    return this.db.tipoDispositivo.create({ data: input });
  }

  async updateTipo(id: string, input: UpdateTipoDispositivoInput) {
    const existing = await this.db.tipoDispositivo.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Tipo de dispositivo no encontrado");
    return this.db.tipoDispositivo.update({ where: { id }, data: input });
  }

  async deleteTipo(id: string) {
    const count = await this.db.dispositivo.count({ where: { tipoId: id } });
    if (count > 0) {
      throw new HttpError(409, "El tipo tiene dispositivos; no se puede eliminar");
    }
    return this.db.tipoDispositivo.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Dispositivos
  // ---------------------------------------------------------------------------
  listDispositivos(filters: { tipoId?: string; q?: string } = {}) {
    const where: Prisma.DispositivoWhereInput = {};
    if (filters.tipoId) where.tipoId = filters.tipoId;
    if (filters.q) {
      where.OR = [
        { nombre: { contains: filters.q, mode: "insensitive" } },
        { marca: { contains: filters.q, mode: "insensitive" } },
        { modelo: { contains: filters.q, mode: "insensitive" } },
      ];
    }
    return this.db.dispositivo.findMany({
      where,
      orderBy: { nombre: "asc" },
      include: { tipo: true },
    });
  }

  // Lista de dispositivos con existencias por estado (para tablas).
  async listDispositivosConExistencias(filters: { tipoId?: string; q?: string } = {}) {
    const dispositivos = await this.listDispositivos(filters);
    const ids = dispositivos.map((d) => d.id);
    if (ids.length === 0) return dispositivos;

    const rows = await this.db.unidadFisica.groupBy({
      by: ["dispositivoId", "estado"],
      where: { dispositivoId: { in: ids } },
      _count: { _all: true },
    });

    const map: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (map[r.dispositivoId] ??= {})[r.estado] = r._count._all;
    }

    return dispositivos.map((d) => {
      const ex = map[d.id] ?? {};
      const total =
        (ex.DISPONIBLE ?? 0) +
        (ex.PRESTADO ?? 0) +
        (ex.DANADO ?? 0) +
        (ex.MANTENIMIENTO ?? 0) +
        (ex.BAJA ?? 0);
      return {
        ...d,
        existencias: {
          total,
          DISPONIBLE: ex.DISPONIBLE ?? 0,
          PRESTADO: ex.PRESTADO ?? 0,
          DANADO: ex.DANADO ?? 0,
          MANTENIMIENTO: ex.MANTENIMIENTO ?? 0,
          BAJA: ex.BAJA ?? 0,
        },
      };
    });
  }

  getDispositivo(id: string) {
    return this.db.dispositivo.findUnique({
      where: { id },
      include: { tipo: true },
    });
  }

  async createDispositivo(input: CreateDispositivoInput, autorId?: string) {
    if (!autorId) throw new HttpError(400, "User ID requerido");
    return this.db.$transaction(
      async (tx) => {
        const tipo = await tx.tipoDispositivo.findUnique({
          where: { id: input.tipoId },
        });
        if (!tipo || !tipo.active) {
          throw new HttpError(400, "Tipo de dispositivo inválido");
        }

        const dispositivo = await tx.dispositivo.create({
          data: {
            tipoId: input.tipoId,
            nombre: input.nombre,
            marca: input.marca,
            modelo: input.modelo,
            descripcion: input.descripcion,
            observaciones: input.observaciones,
          },
        });

        const unidadesData =
          input.unidades && input.unidades.length > 0
            ? input.unidades
            : Array.from({ length: input.cantidadInicial ?? 0 }, () => ({} as { numeroSerie?: string; macAddress?: string; ip?: string; nombreEquipo?: string }));

        const unidades = [];
        let contador = tipo.contador;
        for (let i = 0; i < unidadesData.length; i++) {
          contador += 1;
          const activoFijo = `${tipo.folioPrefix}-${String(contador).padStart(4, "0")}`;
          unidades.push(
            tx.unidadFisica.create({
              data: {
                dispositivoId: dispositivo.id,
                activoFijo,
                estado: "DISPONIBLE",
                numeroSerie: unidadesData[i].numeroSerie || null,
                macAddress: unidadesData[i].macAddress || null,
                ip: unidadesData[i].ip || null,
                nombreEquipo: unidadesData[i].nombreEquipo || null,
              },
            })
          );
        }
        await Promise.all(unidades);
        await tx.tipoDispositivo.update({
          where: { id: tipo.id },
          data: { contador },
        });

        await tx.movimiento.create({
          data: {
            tipo: "ENTRADA",
            usuarioId: autorId,
            motivo: "Alta inicial",
            detalles: {
              create: [{ dispositivoId: dispositivo.id, cantidad: unidadesData.length }],
            },
          },
        });

        return dispositivo;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async updateDispositivo(id: string, input: UpdateDispositivoInput) {
    const existing = await this.db.dispositivo.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Dispositivo no encontrado");
    return this.db.dispositivo.update({ where: { id }, data: input });
  }

  async updateUnidad(id: string, input: UpdateUnidadInput) {
    const existing = await this.db.unidadFisica.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Unidad no encontrada");
    return this.db.unidadFisica.update({ where: { id }, data: input });
  }

  async deleteDispositivo(id: string) {
    const count = await this.db.unidadFisica.count({ where: { dispositivoId: id } });
    if (count > 0) {
      throw new HttpError(409, "El dispositivo tiene unidades; no se puede eliminar");
    }
    return this.db.dispositivo.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Existencias y Kardex
  // ---------------------------------------------------------------------------
  async existencias(dispositivoId: string) {
    const rows = await this.db.unidadFisica.groupBy({
      by: ["estado"],
      where: { dispositivoId },
      _count: { _all: true },
    });
    const map: Record<EstadoInventario, number> = {
      DISPONIBLE: 0,
      PRESTADO: 0,
      DANADO: 0,
      MANTENIMIENTO: 0,
      BAJA: 0,
    };
    for (const r of rows) map[r.estado as EstadoInventario] = r._count._all;
    const activa = map.DISPONIBLE + map.PRESTADO + map.DANADO + map.MANTENIMIENTO;
    return { ...map, activa, historica: activa + map.BAJA };
  }

  async unidades(dispositivoId: string) {
    return this.db.unidadFisica.findMany({
      where: { dispositivoId },
      orderBy: { activoFijo: "asc" },
      select: UNIDAD_SELECT,
    });
  }

  async kardex(dispositivoId: string) {
    const dispositivo = await this.db.dispositivo.findUnique({
      where: { id: dispositivoId },
      include: { tipo: true },
    });
    if (!dispositivo) throw new HttpError(404, "Dispositivo no encontrado");

    const detalles = await this.db.movimientoDetalle.findMany({
      where: { dispositivoId },
      orderBy: { movimiento: { fecha: "asc" } },
      include: { movimiento: { include: { usuario: { select: { id: true, name: true } } } } },
    });

    let saldo = 0;
    const rows = detalles.map((d) => {
      const esEntrada = ["ENTRADA", "DEVOLUCION", "AJUSTE_ENTRADA", "MANTENIMIENTO_SALIDA", "REVERSION"].includes(
        d.movimiento.tipo
      );
      const delta = esEntrada ? d.cantidad : -d.cantidad;
      saldo += delta;
      return {
        fecha: d.movimiento.fecha,
        tipo: d.movimiento.tipo,
        entrada: esEntrada ? d.cantidad : 0,
        salida: esEntrada ? 0 : d.cantidad,
        saldo,
        condicion: (d.condicion ?? null) as any,
        motivo: d.movimiento.motivo,
        observaciones: d.movimiento.observaciones,
        usuario: d.movimiento.usuario?.name ?? null,
      };
    });

    return { dispositivo, existencias: await this.existencias(dispositivoId), rows };
  }

  // ---------------------------------------------------------------------------
  // Movimientos
  // ---------------------------------------------------------------------------
  async registerMovimiento(input: CreateMovimientoInput, autorId?: string) {
    if (!autorId) throw new HttpError(400, "User ID requerido");
    return this.db.$transaction(
      async (tx) => {
        switch (input.tipo) {
          case "ENTRADA":
          case "AJUSTE_ENTRADA":
            return this.movEntrada(tx, input, autorId);
          case "BAJA":
          case "AJUSTE_SALIDA":
            return this.movBaja(tx, input, autorId);
          case "PRESTAMO":
            return this.movPrestamo(tx, input, autorId);
          case "DEVOLUCION":
            return this.movDevolucion(tx, input, autorId);
          case "TRASPASO":
            return this.movTraspaso(tx, input, autorId);
          case "MANTENIMIENTO_ENTRADA":
            return this.movMantenimientoEntrada(tx, input, autorId);
          case "MANTENIMIENTO_SALIDA":
            return this.movMantenimientoSalida(tx, input, autorId);
          case "REVERSION":
            return this.movReversion(tx, input, autorId);
          default:
            throw new HttpError(400, "Tipo de movimiento no soportado");
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async nextActivo(tx: Tx, tipoId: string) {
    const tipo = await tx.tipoDispositivo.findUnique({ where: { id: tipoId } });
    if (!tipo) throw new HttpError(400, "Tipo de dispositivo inválido");
    const contador = tipo.contador + 1;
    await tx.tipoDispositivo.update({ where: { id: tipoId }, data: { contador } });
    return `${tipo.folioPrefix}-${String(contador).padStart(4, "0")}`;
  }

  private async selectUnidades(
    tx: Tx,
    dispositivoId: string,
    estado: EstadoInventario,
    cantidad: number
  ) {
    return tx.unidadFisica.findMany({
      where: { dispositivoId, estado },
      orderBy: { activoFijo: "asc" },
      take: cantidad,
      select: UNIDAD_SELECT,
    });
  }

  private async assertDispositivo(tx: Tx, dispositivoId: string) {
    const d = await tx.dispositivo.findUnique({ where: { id: dispositivoId } });
    if (!d) throw new HttpError(404, `Dispositivo ${dispositivoId} no encontrado`);
    return d;
  }

  // Resuelve las unidades objetivo de un detalle: si trae `unidadId`, usa esa
  // unidad física exacta (1 a 1); si no, elige las primeras `cantidad` unidades.
  private async resolveTargetUnidades(
    tx: Tx,
    det: MovimientoDetalleInput,
    estadoOrigen: EstadoInventario,
    missingMsg: string
  ) {
    if (det.unidadId) {
      if (det.cantidad && det.cantidad > 1) {
        throw new HttpError(400, "La selección de unidad física aplica a una sola unidad");
      }
      const unidad = await tx.unidadFisica.findUnique({ where: { id: det.unidadId } });
      if (!unidad) throw new HttpError(404, "Unidad física no encontrada");
      if (unidad.dispositivoId !== det.dispositivoId) {
        throw new HttpError(400, "La unidad no pertenece al dispositivo seleccionado");
      }
      if (unidad.estado !== estadoOrigen) {
        throw new HttpError(
          409,
          `La unidad ${unidad.activoFijo} está en estado ${unidad.estado}; se esperaba ${estadoOrigen}`
        );
      }
      return [unidad];
    }
    const units = await this.selectUnidades(tx, det.dispositivoId, estadoOrigen, det.cantidad);
    if (units.length < det.cantidad) {
      throw new HttpError(
        409,
        `${missingMsg} ${det.dispositivoId}: se requieren ${det.cantidad}, hay ${units.length}`
      );
    }
    return units;
  }

  // Payload de un detalle para `movimiento.create`, incluyendo la unidad exacta si aplica.
  private detalleData(d: MovimientoDetalleInput) {
    const base: Record<string, unknown> = {
      dispositivoId: d.dispositivoId,
      cantidad: d.unidadId ? 1 : d.cantidad,
      condicion: (d.condicion ?? null) as any,
      observaciones: (d.observaciones ?? null) as any,
    };
    if (d.unidadId) (base.unidades as any) = { create: [{ unidadFisicaId: d.unidadId }] };
    return base;
  }

  // Baja automática de unidades en estado ROTO (devueltas o salidas de mantenimiento).
  private async crearBajaAutomatica(
    tx: Tx,
    autorId: string,
    unidades: { unidadFisicaId: string; dispositivoId: string; observaciones: string | null }[],
    motivoExtra?: string
  ) {
    if (unidades.length === 0) return null;
    const motivo = motivoExtra ?? "Baja automática por estado ROTO";
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "BAJA",
        usuarioId: autorId,
        motivo,
        observaciones: [...new Set(unidades.map((u) => u.observaciones).filter(Boolean))].join(" | ") || null,
        detalles: {
          create: unidades.map((u) =>
            this.detalleData({
              dispositivoId: u.dispositivoId,
              cantidad: 1,
              condicion: "ROTO",
              observaciones: u.observaciones ?? undefined,
              unidadId: u.unidadFisicaId,
            })
          ) as any,
        },
      },
      include: { detalles: true },
    });
    await this.audit(tx, "MOV_BAJA", movimiento.id, autorId, { motivo, unidades });
    this.broadcast("BAJA", unidades.length, movimiento.id, movimiento.detalles[0]?.dispositivoId);
    return movimiento;
  }

  private async movEntrada(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (input.detalles.length === 0) throw new HttpError(400, "Agrega al menos un detalle");
    for (const det of input.detalles) {
      const d = await this.assertDispositivo(tx, det.dispositivoId);
      const tipoId = d.tipoId;
      const units = [];
      for (let i = 0; i < det.cantidad; i++) {
        units.push(
          tx.unidadFisica.create({
            data: {
              dispositivoId: det.dispositivoId,
              activoFijo: await this.nextActivo(tx, tipoId),
              estado: "DISPONIBLE",
            },
          })
        );
      }
      await Promise.all(units);
    }
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: input.tipo,
        usuarioId: autorId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: input.detalles.map((d) => ({ dispositivoId: d.dispositivoId, cantidad: d.cantidad })) },
      },
      include: { detalles: true },
    });
    await this.audit(tx, `MOV_${input.tipo}`, movimiento.id, autorId, input);
    this.broadcast(input.tipo, input.detalles.length, movimiento.id, movimiento.detalles[0]?.dispositivoId);
    return movimiento;
  }

  private async movBaja(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (input.detalles.length === 0) throw new HttpError(400, "Agrega al menos un detalle");
    if (!input.motivo) throw new HttpError(400, "Motivo requerido para la baja");
    for (const det of input.detalles) {
      await this.assertDispositivo(tx, det.dispositivoId);
      const disponibles = await this.resolveTargetUnidades(
        tx,
        det,
        "DISPONIBLE",
        "No hay suficientes unidades disponibles de"
      );
      await tx.unidadFisica.updateMany({
        where: { id: { in: disponibles.map((u) => u.id) } },
        data: { estado: "BAJA" },
      });
    }
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: input.tipo,
        usuarioId: autorId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: input.detalles.map((d) => this.detalleData(d) as any) },
      },
      include: { detalles: true },
    });
    await this.audit(tx, `MOV_${input.tipo}`, movimiento.id, autorId, input);
    this.broadcast(input.tipo, input.detalles.length, movimiento.id, movimiento.detalles[0]?.dispositivoId);
    return movimiento;
  }

  private async movPrestamo(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (!input.responsableId && !input.departamentoId) {
      throw new HttpError(400, "Indica un responsable o un departamento");
    }
    if (input.detalles.length === 0) throw new HttpError(400, "Agrega al menos un detalle");

    const prestamo = await tx.prestamo.create({
      data: {
        responsableId: input.responsableId ?? null,
        departamentoId: input.departamentoId ?? null,
        subareaId: input.subareaId ?? null,
        observaciones: input.observaciones,
        consecutivo: await this.nextPrestamoConsecutivo(tx),
      },
    });

    for (const det of input.detalles) {
      await this.assertDispositivo(tx, det.dispositivoId);
      const disponibles = await this.selectUnidades(tx, det.dispositivoId, "DISPONIBLE", det.cantidad);
      if (disponibles.length < det.cantidad) {
        throw new HttpError(
          409,
          `No hay suficientes unidades disponibles de ${det.dispositivoId}: se requieren ${det.cantidad}, hay ${disponibles.length}`
        );
      }
      const pd = await tx.prestamoDetalle.create({
        data: {
          prestamoId: prestamo.id,
          dispositivoId: det.dispositivoId,
          cantidad: det.cantidad,
        },
      });
      for (const u of disponibles) {
        await tx.prestamoDetalleUnidad.create({
          data: { prestamoDetalleId: pd.id, unidadFisicaId: u.id },
        });
        await tx.unidadFisica.update({
          where: { id: u.id },
          data: { estado: "PRESTADO", departamentoId: input.departamentoId ?? null },
        });
      }
    }

    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "PRESTAMO",
        usuarioId: autorId,
        responsableId: input.responsableId ?? null,
        departamentoId: input.departamentoId ?? null,
        motivo: input.motivo,
        observaciones: input.observaciones,
        prestamo: { connect: { id: prestamo.id } },
        detalles: { create: input.detalles.map((d) => ({ dispositivoId: d.dispositivoId, cantidad: d.cantidad })) },
      },
      include: { detalles: true },
    });
    await tx.prestamo.update({ where: { id: prestamo.id }, data: { movimientoId: movimiento.id } });
    await this.audit(tx, "MOV_PRESTAMO", movimiento.id, autorId, input);
    this.broadcast("PRESTAMO", input.detalles.length, movimiento.id, movimiento.detalles[0]?.dispositivoId);
    return movimiento;
  }

  private async movDevolucion(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (!input.prestamoId) throw new HttpError(400, "Préstamo requerido");
    const prestamo = await tx.prestamo.findUnique({
      where: { id: input.prestamoId },
      include: { detalles: true },
    });
    if (!prestamo) throw new HttpError(404, "Préstamo no encontrado");
    if (prestamo.status === "DEVUELTO" || prestamo.status === "CANCELADO") {
      throw new HttpError(409, "El préstamo ya está devuelto o cancelado");
    }

    const detallesEfectivos: MovimientoDetalleInput[] = [];
    const unidadesBaja: { unidadFisicaId: string; dispositivoId: string; observaciones: string | null }[] = [];
    // Una devolución puede traer varias líneas del mismo detalle de préstamo
    // (§14: unas piezas vuelven bien y otras dañadas). `prestamo.detalles` es
    // una foto previa al ciclo, así que lo devuelto se acumula aquí en vez de
    // releer `pd.devuelto` en cada vuelta — si no, la última línea pisaría a
    // las anteriores y el préstamo nunca cerraría.
    const devueltoPorDetalle = new Map<string, number>();
    for (const det of input.detalles) {
      if (!det.prestamoDetalleId) throw new HttpError(400, "prestamoDetalleId requerido en devolución");
      const pd = prestamo.detalles.find((x) => x.id === det.prestamoDetalleId);
      if (!pd) throw new HttpError(404, "Detalle de préstamo no encontrado");
      const yaDevuelto = devueltoPorDetalle.get(pd.id) ?? pd.devuelto;
      const pendiente = pd.cantidad - yaDevuelto;
      if (det.cantidad > pendiente) {
        throw new HttpError(409, `La devolución excede el pendiente (${pendiente}) del detalle`);
      }

      const unidadesPrestadas = await tx.prestamoDetalleUnidad.findMany({
        where: { prestamoDetalleId: pd.id, devuelto: false },
        orderBy: { unidadFisica: { activoFijo: "asc" } },
        take: det.cantidad,
        include: { unidadFisica: true },
      });
      if (unidadesPrestadas.length < det.cantidad) {
        throw new HttpError(409, "No hay suficientes unidades pendientes de devolución");
      }

      const nuevoEstado = condicionToEstado(det.condicion as Condicion);
      for (const pu of unidadesPrestadas) {
        await tx.unidadFisica.update({
          where: { id: pu.unidadFisicaId },
          data: { estado: nuevoEstado },
        });
        if (nuevoEstado === "BAJA") {
          unidadesBaja.push({
            unidadFisicaId: pu.unidadFisicaId,
            dispositivoId: pu.unidadFisica.dispositivoId,
            observaciones: det.observaciones ?? null,
          });
        }
        await tx.prestamoDetalleUnidad.update({
          where: { id: pu.id },
          data: { devuelto: true },
        });
      }
      const totalDevuelto = yaDevuelto + det.cantidad;
      devueltoPorDetalle.set(pd.id, totalDevuelto);
      await tx.prestamoDetalle.update({
        where: { id: pd.id },
        data: { devuelto: totalDevuelto },
      });

      detallesEfectivos.push({
        dispositivoId: pd.dispositivoId,
        cantidad: det.cantidad,
        condicion: det.condicion as any,
        observaciones: det.observaciones,
      });
    }

    // Recalcular estado del préstamo.
    const updatedDetalles = await tx.prestamoDetalle.findMany({ where: { prestamoId: prestamo.id } });
    const totalmenteDevuelto = updatedDetalles.every((d) => d.devuelto >= d.cantidad);
    const parcial = updatedDetalles.some((d) => d.devuelto > 0);
    await tx.prestamo.update({
      where: { id: prestamo.id },
      data: { status: totalmenteDevuelto ? "DEVUELTO" : parcial ? "PARCIAL" : "ACTIVO" },
    });

    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "DEVOLUCION",
        usuarioId: autorId,
        responsableId: input.responsableId ?? prestamo.responsableId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: detallesEfectivos.map((d) => ({ dispositivoId: d.dispositivoId, cantidad: d.cantidad, condicion: (d.condicion ?? null) as any, observaciones: (d.observaciones ?? null) as any })) },
      },
      include: { detalles: true },
    });

    const devolucion = await tx.devolucion.create({
      data: {
        prestamoId: prestamo.id,
        movimientoId: movimiento.id,
        responsableId: input.responsableId ?? prestamo.responsableId,
        consecutivo: await this.nextDevolucionConsecutivo(tx),
        observaciones: input.observaciones,
      },
    });
    for (const det of input.detalles) {
      const pd = (await tx.prestamoDetalle.findUnique({ where: { id: det.prestamoDetalleId! } }))!;
      await tx.devolucionDetalle.create({
        data: {
          devolucionId: devolucion.id,
          prestamoDetalleId: det.prestamoDetalleId!,
          dispositivoId: pd.dispositivoId,
          cantidad: det.cantidad,
          condicion: det.condicion as any,
          observaciones: (det.observaciones ?? null) as any,
        },
      });
    }

    await this.audit(tx, "MOV_DEVOLUCION", movimiento.id, autorId, input);
    await this.crearBajaAutomatica(tx, autorId, unidadesBaja);
    this.broadcast("DEVOLUCION", detallesEfectivos.length, movimiento.id, movimiento.detalles[0]?.dispositivoId);
    return movimiento;
  }

  private async movTraspaso(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (!input.departamentoId) throw new HttpError(400, "Departamento requerido");
    if (input.detalles.length === 0) throw new HttpError(400, "Agrega al menos un detalle");
    for (const det of input.detalles) {
      await this.assertDispositivo(tx, det.dispositivoId);
      const disponibles = await this.selectUnidades(tx, det.dispositivoId, "DISPONIBLE", det.cantidad);
      if (disponibles.length < det.cantidad) {
        throw new HttpError(409, `No hay suficientes unidades disponibles de ${det.dispositivoId}`);
      }
      await tx.unidadFisica.updateMany({
        where: { id: { in: disponibles.map((u) => u.id) } },
        data: { departamentoId: input.departamentoId },
      });
    }
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "TRASPASO",
        usuarioId: autorId,
        departamentoId: input.departamentoId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: input.detalles.map((d) => ({ dispositivoId: d.dispositivoId, cantidad: d.cantidad })) },
      },
      include: { detalles: true },
    });
    await this.audit(tx, "MOV_TRASPASO", movimiento.id, autorId, input);
    return movimiento;
  }

  private async movMantenimientoEntrada(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    for (const det of input.detalles) {
      await this.assertDispositivo(tx, det.dispositivoId);
      const disponibles = await this.resolveTargetUnidades(
        tx,
        det,
        "DISPONIBLE",
        "No hay suficientes unidades disponibles de"
      );
      await tx.unidadFisica.updateMany({
        where: { id: { in: disponibles.map((u) => u.id) } },
        data: { estado: "MANTENIMIENTO" },
      });
    }
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "MANTENIMIENTO_ENTRADA",
        usuarioId: autorId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: input.detalles.map((d) => this.detalleData(d) as any) },
      },
      include: { detalles: true },
    });
    await this.audit(tx, "MOV_MANT_ENTRADA", movimiento.id, autorId, input);
    return movimiento;
  }

  private async movMantenimientoSalida(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    const unidadesBaja: { unidadFisicaId: string; dispositivoId: string; observaciones: string | null }[] = [];
    for (const det of input.detalles) {
      await this.assertDispositivo(tx, det.dispositivoId);
      const enMantenimiento = await this.resolveTargetUnidades(
        tx,
        det,
        "MANTENIMIENTO",
        "No hay suficientes unidades en mantenimiento de"
      );
      const nuevoEstado = condicionToEstado(det.condicion as Condicion | null);
      for (const u of enMantenimiento) {
        await tx.unidadFisica.update({
          where: { id: u.id },
          data: { estado: nuevoEstado },
        });
        if (nuevoEstado === "BAJA") {
          unidadesBaja.push({ unidadFisicaId: u.id, dispositivoId: u.dispositivoId, observaciones: det.observaciones ?? null });
        }
      }
    }
    const movimiento = await tx.movimiento.create({
      data: {
        tipo: "MANTENIMIENTO_SALIDA",
        usuarioId: autorId,
        motivo: input.motivo,
        observaciones: input.observaciones,
        detalles: { create: input.detalles.map((d) => this.detalleData(d) as any) },
      },
      include: { detalles: true },
    });
    await this.audit(tx, "MOV_MANT_SALIDA", movimiento.id, autorId, input);
    await this.crearBajaAutomatica(tx, autorId, unidadesBaja);
    return movimiento;
  }

  private async movReversion(tx: Tx, input: CreateMovimientoInput, autorId: string) {
    if (!input.movimientoId) throw new HttpError(400, "movimientoId requerido");
    const origen = await tx.movimiento.findUnique({
      where: { id: input.movimientoId },
      include: { detalles: { include: { unidades: true } }, prestamo: { include: { detalles: true } } },
    });
    if (!origen) throw new HttpError(404, "Movimiento origen no encontrado");
    if (origen.status === "CANCELADO") throw new HttpError(409, "El movimiento ya fue revertido");

    // Unidades exactas registradas en el movimiento origen (si las tiene).
    const resolver = (det: { id: string; dispositivoId: string; cantidad: number; unidades: { unidadFisicaId: string }[] }, estadoOrigen: EstadoInventario) => {
      if (det.unidades.length > 0) {
        return det.unidades.map((u) => u.unidadFisicaId);
      }
      return this.selectUnidades(tx, det.dispositivoId, estadoOrigen, det.cantidad).then((units) =>
        units.map((u) => u.id)
      );
    };

    switch (origen.tipo) {
      case "MANTENIMIENTO_ENTRADA": {
        for (const det of origen.detalles) {
          const ids = await resolver(det, "MANTENIMIENTO");
          await tx.unidadFisica.updateMany({
            where: { id: { in: ids } },
            data: { estado: "DISPONIBLE" },
          });
        }
        break;
      }
      case "MANTENIMIENTO_SALIDA": {
        for (const det of origen.detalles) {
          if (det.condicion === "ROTO") continue;
          const ids = await resolver(det, "DISPONIBLE");
          await tx.unidadFisica.updateMany({
            where: { id: { in: ids } },
            data: { estado: "MANTENIMIENTO" },
          });
        }
        break;
      }
      default:
        throw new HttpError(409, "Este tipo de movimiento no admite reversión");
    }

    await tx.movimiento.update({ where: { id: origen.id }, data: { status: "CANCELADO" } });
    const reversion = await tx.movimiento.create({
      data: {
        tipo: "REVERSION",
        usuarioId: autorId,
        motivo: `Reversión de ${origen.tipo}`,
        observaciones: input.observaciones,
        // FK escalar, no `reversaDe: { connect }`: al fijar `usuarioId` el input
        // ya es el variante "unchecked" de Prisma, que no acepta relaciones.
        reversaDeId: origen.id,
        detalles: {
          create: origen.detalles
            .filter((d) => d.condicion !== "ROTO")
            .map((d) => ({
              dispositivoId: d.dispositivoId,
              cantidad: d.cantidad,
              condicion: (d.condicion ?? null) as any,
              observaciones: (d.observaciones ?? null) as any,
              ...(d.unidades.length > 0 ? { unidades: { create: d.unidades.map((u) => ({ unidadFisicaId: u.unidadFisicaId })) } } : {}),
            })),
        },
      } satisfies Prisma.MovimientoUncheckedCreateInput,
      include: { detalles: true },
    });
    await this.audit(tx, "MOV_REVERSION", reversion.id, autorId, input);
    return reversion;
  }

  listMovimientos(filters: { tipo?: string; dispositivoId?: string } = {}) {
    const where: Prisma.MovimientoWhereInput = {};
    if (filters.tipo) where.tipo = filters.tipo as TipoMovimiento;
    if (filters.dispositivoId) where.detalles = { some: { dispositivoId: filters.dispositivoId } };
    return this.db.movimiento.findMany({
      where,
      orderBy: { fecha: "desc" },
      include: {
        detalles: {
          include: {
            dispositivo: { include: { tipo: true } },
            unidades: { include: { unidadFisica: true } },
          },
        },
        usuario: { select: { id: true, name: true } },
        responsable: { select: { id: true, name: true } },
        prestamo: true,
      },
    });
  }

  getMovimiento(id: string) {
    return this.db.movimiento.findUnique({
      where: { id },
      include: {
        detalles: {
          include: {
            dispositivo: { include: { tipo: true } },
            unidades: { include: { unidadFisica: true } },
          },
        },
        usuario: { select: { id: true, name: true } },
        responsable: { select: { id: true, name: true } },
        reversaDe: true,
        prestamo: { include: { detalles: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Préstamos y devoluciones
  // ---------------------------------------------------------------------------
  listPrestamos(filters: { status?: string; responsableId?: string } = {}) {
    const where: Prisma.PrestamoWhereInput = {};
    if (filters.status) where.status = filters.status as any;
    if (filters.responsableId) where.responsableId = filters.responsableId;
    return this.db.prestamo.findMany({
      where,
      orderBy: { fecha: "desc" },
      include: {
        responsable: { select: { id: true, name: true, username: true, numeroEmpleado: true } },
        departamento: { select: { id: true, name: true } },
        subarea: { select: { id: true, name: true } },
        detalles: {
          include: { dispositivo: { include: { tipo: true } } },
        },
        devoluciones: { select: { id: true, consecutivo: true, fecha: true } },
      },
    });
  }

  getPrestamo(id: string) {
    return this.db.prestamo.findUnique({
      where: { id },
      include: {
        responsable: { select: { id: true, name: true, username: true, numeroEmpleado: true } },
        departamento: { select: { id: true, name: true } },
        subarea: { select: { id: true, name: true } },
        detalles: {
          include: {
            dispositivo: { include: { tipo: true } },
            unidades: { include: { unidadFisica: true } },
          },
        },

        devoluciones: {
          include: {
            responsable: { select: { id: true, name: true } },
            detalles: {
              include: {
                dispositivo: { select: { id: true, nombre: true } },
                unidades: { include: { unidadFisica: true } },
              },
            },
          },
        },
      },
    });
  }

  async updatePrestamo(id: string, input: UpdatePrestamoInput) {
    return this.db.$transaction(
      async (tx) => {
        const prestamo = await tx.prestamo.findUnique({
          where: { id },
          include: {
            detalles: { include: { unidades: { include: { unidadFisica: true } } } },
            movimiento: true,
          },
        });
        if (!prestamo) throw new HttpError(404, "Préstamo no encontrado");
        if (prestamo.status === "DEVUELTO" || prestamo.status === "CANCELADO") {
          throw new HttpError(409, "El préstamo ya está devuelto o cancelado");
        }

        const recursoChange = input.dispositivoId !== undefined || input.cantidad !== undefined;
        const tieneDevoluciones = prestamo.detalles.some((d) => d.devuelto > 0);
        if (recursoChange && tieneDevoluciones) {
          throw new HttpError(
            409,
            "El préstamo ya tiene devoluciones; no se puede editar el recurso, solo la asignación"
          );
        }

        // Asignación / observaciones
        const data: Record<string, unknown> = {};
        if (input.responsableId !== undefined) data.responsableId = input.responsableId || null;
        if (input.departamentoId !== undefined) data.departamentoId = input.departamentoId || null;
        if (input.subareaId !== undefined) data.subareaId = input.subareaId || null;
        if (input.observaciones !== undefined) data.observaciones = input.observaciones || null;
        if (Object.keys(data).length > 0) {
          await tx.prestamo.update({ where: { id }, data });
        }

        // Recurso (solo si no hay devoluciones)
        if (recursoChange && !tieneDevoluciones) {
          const detalle = prestamo.detalles[0];
          if (!detalle) throw new HttpError(400, "El préstamo no tiene detalle");
          const dispositivoId = input.dispositivoId ?? detalle.dispositivoId;
          const cantidad = input.cantidad ?? detalle.cantidad;
          const nuevoDispositivo = await tx.dispositivo.findUnique({ where: { id: dispositivoId } });
          if (!nuevoDispositivo) throw new HttpError(404, "Dispositivo no encontrado");

          // Liberar unidades prestadas (aún no devueltas) de este préstamo.
          for (const pu of detalle.unidades) {
            if (!pu.devuelto) {
              await tx.unidadFisica.update({
                where: { id: pu.unidadFisicaId },
                data: { estado: "DISPONIBLE" },
              });
              await tx.prestamoDetalleUnidad.delete({ where: { id: pu.id } });
            }
          }

          // Validar disponibilidad y asignar las nuevas unidades.
          const disponibles = await tx.unidadFisica.findMany({
            where: { dispositivoId, estado: "DISPONIBLE" },
            orderBy: { activoFijo: "asc" },
            take: cantidad,
            select: UNIDAD_SELECT,
          });
          if (disponibles.length < cantidad) {
            throw new HttpError(
              409,
              `No hay suficientes unidades disponibles: se requieren ${cantidad}, hay ${disponibles.length}`
            );
          }
          await tx.prestamoDetalle.update({
            where: { id: detalle.id },
            data: { dispositivoId, cantidad },
          });
          const deptId = (input.departamentoId ?? prestamo.departamentoId) || null;
          for (const u of disponibles) {
            await tx.prestamoDetalleUnidad.create({
              data: { prestamoDetalleId: detalle.id, unidadFisicaId: u.id },
            });
            await tx.unidadFisica.update({
              where: { id: u.id },
              data: { estado: "PRESTADO", departamentoId: deptId },
            });
          }
        }

        // Mantener el movimiento PRESTAMO consistente (cabecera + detalle).
        if (prestamo.movimiento) {
          const movData: Record<string, unknown> = {};
          if (input.responsableId !== undefined) movData.responsableId = input.responsableId || null;
          if (input.departamentoId !== undefined) movData.departamentoId = input.departamentoId || null;
          if (input.observaciones !== undefined) movData.observaciones = input.observaciones || null;
          if (Object.keys(movData).length > 0) {
            await tx.movimiento.update({ where: { id: prestamo.movimiento.id }, data: movData });
          }
          if (recursoChange && !tieneDevoluciones) {
            const md = await tx.movimientoDetalle.findFirst({
              where: { movimientoId: prestamo.movimiento.id },
            });
            if (md) {
              const detalle = prestamo.detalles[0];
              const dispositivoId = input.dispositivoId ?? detalle?.dispositivoId ?? md.dispositivoId;
              const cantidad = input.cantidad ?? md.cantidad;
              await tx.movimientoDetalle.update({
                where: { id: md.id },
                data: { dispositivoId, cantidad },
              });
            }
          }
        }

        // Dentro de `tx`: leer por `this.db` usa otra conexión y, con aislamiento
        // Serializable, devolvería el préstamo previo a esta misma edición.
        return tx.prestamo.findUnique({
          where: { id },
          include: {
            responsable: { select: { id: true, name: true, username: true, numeroEmpleado: true } },
            departamento: { select: { id: true, name: true } },
            subarea: { select: { id: true, name: true } },
            detalles: {
              include: {
                dispositivo: { include: { tipo: true } },
                unidades: { include: { unidadFisica: true } },
              },
            },
devoluciones: {
          include: {
            responsable: { select: { id: true, name: true } },
            detalles: {
              include: {
                dispositivo: { select: { id: true, nombre: true } },
                unidades: { include: { unidadFisica: true } },
              },
            },
          },
        },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async cancelarPrestamo(id: string) {
    const prestamo = await this.db.prestamo.findUnique({ where: { id } });
    if (!prestamo) throw new HttpError(404, "Préstamo no encontrado");
    if (prestamo.status === "DEVUELTO" || prestamo.status === "CANCELADO") {
      throw new HttpError(409, "El préstamo ya está devuelto o cancelado");
    }
    return this.db.$transaction(async (tx) => {
      const detalles = await tx.prestamoDetalle.findMany({ where: { prestamoId: id } });
      for (const pd of detalles) {
        const pendientes = await tx.prestamoDetalleUnidad.findMany({
          where: { prestamoDetalleId: pd.id, devuelto: false },
        });
        await tx.unidadFisica.updateMany({
          where: { id: { in: pendientes.map((u) => u.unidadFisicaId) } },
          data: { estado: "DISPONIBLE" },
        });
        await tx.prestamoDetalleUnidad.updateMany({
          where: { id: { in: pendientes.map((u) => u.id) } },
          data: { devuelto: true },
        });
        await tx.prestamoDetalle.update({ where: { id: pd.id }, data: { devuelto: pd.cantidad } });
      }
      return tx.prestamo.update({ where: { id }, data: { status: "CANCELADO" } });
    });
  }

  listDevoluciones(filters: { prestamoId?: string } = {}) {
    const where: Prisma.DevolucionWhereInput = {};
    if (filters.prestamoId) where.prestamoId = filters.prestamoId;
    return this.db.devolucion.findMany({
      where,
      orderBy: { fecha: "desc" },
      include: {
        prestamo: {
          select: {
            id: true,
            consecutivo: true,
            responsable: { select: { name: true } },
            departamento: { select: { name: true } },
          },
        },
        detalles: { include: { dispositivo: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  async dashboard() {
    const [tipos, dispositivos, unidades] = await Promise.all([
      this.db.tipoDispositivo.count(),
      this.db.dispositivo.count(),
      this.db.unidadFisica.findMany({ select: { estado: true } }),
    ]);

    const map: Record<EstadoInventario, number> = {
      DISPONIBLE: 0,
      PRESTADO: 0,
      DANADO: 0,
      MANTENIMIENTO: 0,
      BAJA: 0,
    };
    for (const u of unidades) map[u.estado] += 1;
    const activas = map.DISPONIBLE + map.PRESTADO + map.DANADO + map.MANTENIMIENTO;

    const porTipo = await this.db.tipoDispositivo.findMany({
      orderBy: { name: "asc" },
      include: {
        dispositivos: {
          include: {
            unidades: { select: { estado: true } },
          },
        },
      },
    });

    return {
      stats: {
        tipos,
        dispositivos,
        unidadesActivas: activas,
        disponible: map.DISPONIBLE,
        prestado: map.PRESTADO,
        danado: map.DANADO,
        mantenimiento: map.MANTENIMIENTO,
        baja: map.BAJA,
      },
      porTipo: porTipo.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        dispositivos: t.dispositivos.map((d) => {
          const estados: Record<EstadoInventario, number> = {
            DISPONIBLE: 0,
            PRESTADO: 0,
            DANADO: 0,
            MANTENIMIENTO: 0,
            BAJA: 0,
          };
          for (const u of d.unidades) estados[u.estado] += 1;
          return {
            id: d.id,
            nombre: d.nombre,
            marca: d.marca,
            modelo: d.modelo,
            disponible: estados.DISPONIBLE,
            prestado: estados.PRESTADO,
            danado: estados.DANADO,
            mantenimiento: estados.MANTENIMIENTO,
            baja: estados.BAJA,
            total: d.unidades.length,
          };
        }),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------
  private async nextPrestamoConsecutivo(tx: Tx) {
    const count = await tx.prestamo.count();
    return `CARTA-${String(count + 1).padStart(4, "0")}`;
  }

  private async nextDevolucionConsecutivo(tx: Tx) {
    const count = await tx.devolucion.count();
    return `DEV-${String(count + 1).padStart(4, "0")}`;
  }

  private async audit(
    tx: Tx,
    action: string,
    entityId: string,
    userId: string,
    input: unknown
  ) {
    const data = input as Record<string, unknown>;
    await this.auditPort.createLog(
      {
        action,
        entityType: "Movimiento",
        entityId,
        userId,
        newState: {
          tipo: data.tipo,
          detalles: data.detalles,
          motivo: data.motivo,
          observaciones: data.observaciones,
        },
      },
      tx as any
    );
  }

  private broadcast(tipo: TipoMovimiento, count: number, targetId?: string, deviceId?: string | null) {
    broadcastDashboardEvent({
      scope: "inventory",
      message: `${tipo} · ${count} detalle(s)`,
      targetId,
      deviceId: deviceId ?? undefined,
    }).catch(() => {});
  }
}