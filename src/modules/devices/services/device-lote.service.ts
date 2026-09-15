import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { randomUUID } from "node:crypto";
import type { LoteSharedInput, LoteUnitInput } from "../models/entity/device.entity";
import { DeviceFieldValidator } from "./device-field-validator";
import type { DeviceTypePort } from "./ports";

export class DeviceLoteService {
  private readonly fields: DeviceFieldValidator;

  constructor(
    private readonly deviceTypePort: DeviceTypePort,
    private readonly db = prismaClient
  ) {
    this.fields = new DeviceFieldValidator(deviceTypePort);
  }

  async listByLote(loteId: string) {
    const devices = await this.db.device.findMany({
      where: { loteId },
      include: { type: true },
      orderBy: { controlActivos: "asc" },
    });
    if (devices.length === 0) throw new HttpError(404, "Lote no encontrado");
    return devices;
  }

  async updateLote(
    loteId: string,
    shared: LoteSharedInput,
    units: LoteUnitInput[],
    autorId?: string
  ) {
    const devices = await this.db.device.findMany({
      where: { loteId },
      include: { type: true },
    });
    if (devices.length === 0) throw new HttpError(404, "Lote no encontrado");

    const currentType = devices[0].type;
    const changingType = !!shared.typeId && shared.typeId !== currentType.id;

    let type = currentType;
    let counter = currentType.contador;

    if (changingType) {
      // Cambiar el tipo de un lote reasigna el folio (control de activos) de
      // cada unidad al nuevo prefijo, igual que al cambiar el tipo de un
      // dispositivo individual. Solo se permite si nadie tiene una unidad
      // prestada: los identificadores de una unidad ASIGNADO están
      // protegidos y no deben perder su folio ni su tipo bajo el préstamo.
      if (devices.some((d) => d.estado === "ASIGNADO")) {
        throw new HttpError(
          409,
          "No se puede cambiar el tipo del lote: hay unidades asignadas (prestadas). Registra su devolución antes de cambiar el tipo."
        );
      }
      const newType = await this.db.deviceType.findUnique({ where: { id: shared.typeId! } });
      if (!newType || !newType.active) {
        throw new HttpError(400, "Tipo de dispositivo inválido");
      }
      type = newType;
      counter = newType.contador;
    }

    // Specs compartidas (validadas contra el tipo destino del lote)
    const sharedSistemaOp = this.fields.normalize(type, "sistemaOp", shared.sistemaOp);
    const sharedRam = this.fields.normalize(type, "ram", shared.ram);
    const sharedAlmacenamiento = this.fields.normalize(type, "almacenamiento", shared.almacenamiento);

    this.assertNoDuplicates(devices, units);

    return this.db.$transaction(async (tx) => {
      const results = [];
      for (const device of devices) {
        const unit = units.find((u) => u.id === device.id);
        const isAssigned = device.estado === "ASIGNADO";

        const data: any = {};
        if (shared.descripcion !== undefined) data.descripcion = shared.descripcion;
        if (shared.marca !== undefined) data.marca = shared.marca;
        if (shared.modelo !== undefined) data.modelo = shared.modelo;
        if (shared.sistemaOp !== undefined) data.sistemaOp = sharedSistemaOp ?? null;
        if (shared.ram !== undefined) data.ram = sharedRam ?? null;
        if (shared.almacenamiento !== undefined) data.almacenamiento = sharedAlmacenamiento ?? null;

        const unitValues = {
          numeroSerie: unit?.numeroSerie !== undefined ? this.fields.normalize(type, "numeroSerie", unit.numeroSerie) : undefined,
          nombreEquipo: unit?.nombreEquipo !== undefined ? this.fields.normalize(type, "nombreEquipo", unit.nombreEquipo) : undefined,
          ip: unit?.ip !== undefined ? this.fields.normalize(type, "ip", unit.ip) : undefined,
          macAddress: unit?.macAddress !== undefined ? this.fields.normalize(type, "macAddress", unit.macAddress) : undefined,
        };

        if (!isAssigned && unit) {
          if (unitValues.numeroSerie !== undefined) data.numeroSerie = unitValues.numeroSerie ?? null;
          if (unitValues.nombreEquipo !== undefined) data.nombreEquipo = unitValues.nombreEquipo ?? null;
          if (unit.area !== undefined && unit.area) data.area = unit.area;
          if (unitValues.ip !== undefined) data.ip = unitValues.ip ?? null;
          if (unitValues.macAddress !== undefined) data.macAddress = unitValues.macAddress ?? null;
        }

        if (changingType) {
          this.fields.validateRequired(type, {
            numeroSerie: unitValues.numeroSerie,
            nombreEquipo: unitValues.nombreEquipo,
            ip: unitValues.ip,
            macAddress: unitValues.macAddress,
            sistemaOp: sharedSistemaOp,
            ram: sharedRam,
            almacenamiento: sharedAlmacenamiento,
          });

          counter += 1;
          data.typeId = type.id;
          data.controlActivos = this.deviceTypePort.formatPrefix(type.prefix, counter);
        }

        const updated = await tx.device.update({
          where: { id: device.id },
          data,
          include: { type: true },
        });

        await tx.deviceHistory.create({
          data: {
            deviceId: device.id,
            type: "UPDATED",
            detail: changingType
              ? `Tipo del lote cambiado a ${type.name} · nuevo folio ${updated.controlActivos}`
              : isAssigned
              ? "Edición de lote (solo datos compartidos; unidad prestada — identificadores protegidos)"
              : "Edición de lote",
            autorId: autorId ?? null,
          },
        });

        results.push(updated);
      }

      if (changingType) {
        await tx.deviceType.update({ where: { id: type.id }, data: { contador: counter } });
      }

      return results;
    });
  }

  // Agrega N unidades nuevas idénticas a partir de un dispositivo existente.
  // Si aún no pertenece a un lote, se convierte en uno (a fin de poder
  // gestionarlas juntas desde ahí en adelante).
  async addUnits(deviceId: string, cantidad: number, autorId?: string) {
    return this.db.$transaction(async (tx) => {
      const source = await tx.device.findUnique({
        where: { id: deviceId },
        include: { type: true },
      });
      if (!source) throw new HttpError(404, "Dispositivo no encontrado");

      let loteId = source.loteId;
      if (!loteId) {
        loteId = randomUUID();
        await tx.device.update({ where: { id: source.id }, data: { loteId } });
      }

      const type = source.type;
      let counter = type.contador;
      const created = [];

      for (let i = 0; i < cantidad; i++) {
        counter += 1;
        const controlActivos = this.deviceTypePort.formatPrefix(type.prefix, counter);

        const device = await tx.device.create({
          data: {
            typeId: source.typeId,
            controlActivos,
            descripcion: source.descripcion,
            marca: source.marca,
            modelo: source.modelo,
            area: source.area,
            estado: "DISPONIBLE",
            numeroSerie: source.numeroSerie,
            nombreEquipo: source.nombreEquipo,
            ip: source.ip,
            macAddress: source.macAddress,
            sistemaOp: source.sistemaOp,
            ram: source.ram,
            almacenamiento: source.almacenamiento,
            departmentId: source.departmentId,
            loteId,
          },
        });

        await tx.deviceHistory.create({
          data: {
            deviceId: device.id,
            type: "CREATED",
            detail: `Unidad agregada al lote de ${source.controlActivos} (${i + 1}/${cantidad}) · ${device.marca} ${device.modelo} · ${device.controlActivos}`,
            autorId: autorId ?? null,
          },
        });

        created.push(device);
      }

      await tx.deviceType.update({
        where: { id: type.id },
        data: { contador: counter },
      });

      await tx.deviceHistory.create({
        data: {
          deviceId: source.id,
          type: "LOTE_EXPANDED",
          detail: `Se agregaron ${cantidad} unidad(es) nueva(s) de este mismo modelo al lote.`,
          autorId: autorId ?? null,
        },
      });

      return { loteId, created };
    });
  }

  private assertNoDuplicates(
    devices: { id: string; estado: string }[],
    units: LoteUnitInput[]
  ) {
    // Duplicados entre las unidades que sí se van a tocar (las ASIGNADO se
    // omiten: sus identificadores quedan protegidos mientras estén prestadas).
    const seenSeries = new Set<string>();
    const seenMacs = new Set<string>();
    const seenIps = new Set<string>();
    for (const u of units) {
      const device = devices.find((d) => d.id === u.id);
      if (!device || device.estado === "ASIGNADO") continue;
      if (u.numeroSerie) {
        const key = u.numeroSerie.trim().toUpperCase();
        if (key) {
          if (seenSeries.has(key)) {
            throw new HttpError(400, `Número de serie duplicado en el lote: ${u.numeroSerie}`);
          }
          seenSeries.add(key);
        }
      }
      if (u.macAddress) {
        const key = u.macAddress.trim().toUpperCase();
        if (seenMacs.has(key)) {
          throw new HttpError(400, `MAC Address duplicada en el lote: ${u.macAddress}`);
        }
        seenMacs.add(key);
      }
      if (u.ip) {
        const key = u.ip.trim();
        if (seenIps.has(key)) {
          throw new HttpError(400, `IP duplicada en el lote: ${u.ip}`);
        }
        seenIps.add(key);
      }
    }
  }
}