import { Prisma } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

const formatFolio = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(4, "0")}`;

export const generateCartasByType = async (
  typeId: string,
  creadoPorId?: string
) => {
  return prismaClient.$transaction(async (tx) => {
    const type = await tx.deviceType.findUnique({ where: { id: typeId } });
    if (!type || !type.active) throw new HttpError(404, "Tipo de dispositivo no encontrado");

    const updated = await tx.deviceType.update({
      where: { id: typeId },
      data: { cartaContador: { increment: 1 } },
    });

    const folio = formatFolio(type.prefix, updated.cartaContador);

    const carta = await tx.cartaResponsiva.create({
      data: {
        consecutive: folio,
        numeroEmpleado: "",
        creadoPorId: creadoPorId ?? null,
        items: {
          create: [
            {
              descripcion: type.name,
              marca: "",
              modelo: "",
              controlActivos: "",
              numeroSerie: "N/A",
              nombreEquipo: "N/A",
            },
          ],
        },
      },
      include: {
        items: { include: { device: { include: { type: true } } } },
        creadoPor: { select: { id: true, username: true, name: true } },
        responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
        encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      },
    });

    return {
      tipo: { code: type.code, name: type.name, prefix: type.prefix },
      contador: updated.cartaContador,
      carta,
    };
  });
};


export interface CartaItemInput {
  deviceId?: string;
  descripcion?: string;
  marca?: string;
  modelo?: string;
  numeroSerie?: string;
  nombreEquipo?: string;
  controlActivos?: string;
  area?: string;
}

export interface CartaInput {
  consecutivo?: string;
  fecha?: string;
  numeroEmpleado: string;
  empresa?: string;
  departamento?: string;
  areaBoss?: string;
  deliveryBy?: string;
  creadoPorId?: string;
  responsableId?: string;
  encargadoId?: string;
  item: CartaItemInput;
}

const formatConsecutivo = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, "0")}`;

// Si el item viene con deviceId, auto-rellena los campos físicos
// desde el Device (descripcion, marca, modelo, controlActivos, etc.).
const resolveItemFromDevice = async (
  tx: Prisma.TransactionClient,
  item: CartaItemInput
): Promise<CartaItemInput> => {
  if (!item.deviceId) return item;
  const dev = await tx.device.findUnique({ where: { id: item.deviceId } });
  if (!dev) throw new HttpError(404, "Dispositivo no encontrado");
  return {
    ...item,
    descripcion: item.descripcion ?? dev.descripcion,
    marca: item.marca ?? dev.marca,
    modelo: item.modelo ?? dev.modelo,
    controlActivos: item.controlActivos ?? dev.controlActivos,
    numeroSerie: item.numeroSerie ?? dev.numeroSerie ?? "N/A",
    nombreEquipo: item.nombreEquipo ?? dev.nombreEquipo ?? "N/A",
    area: item.area ?? dev.area ?? "MANTENIMIENTO",
  };
};

export const listCartas = async (search?: string, userId?: string, role?: string, departmentId?: string | null) => {
  const where: Prisma.CartaResponsivaWhereInput = {};

  if (role === "JEFE_DE_AREA" && departmentId) {
    where.responsable = { departmentId };
  } else if (role === "EMPLEADO" && userId) {
    where.responsableId = userId;
  }

  if (search) {
    where.OR = [
      { consecutive: { contains: search, mode: "insensitive" } },
      { numeroEmpleado: { contains: search, mode: "insensitive" } },
      { items: { some: { descripcion: { contains: search, mode: "insensitive" } } } },
    ];
  }

  return prismaClient.cartaResponsiva.findMany({
    where,
    orderBy: { creadoEn: "desc" },
    include: {
      items: { include: { device: { include: { type: true } } } },
      creadoPor: { select: { id: true, username: true, name: true } },
      responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
    },
  });
};

export const listCartasTable = async (
  params: ITDataTableFetchParams,
  userId?: string,
  role?: string,
  departmentId?: string | null
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: Prisma.CartaResponsivaWhereInput = {};

  if (role === "JEFE_DE_AREA" && departmentId) {
    where.responsable = { departmentId };
  } else if (role === "EMPLEADO" && userId) {
    where.responsableId = userId;
  }

  if (filters.consecutivo) where.consecutive = ci(filters.consecutivo);
  if (filters.numeroEmpleado) where.numeroEmpleado = ci(filters.numeroEmpleado);
  if (filters.departamento) where.departamento = ci(filters.departamento);
  if (filters.empresa) where.empresa = ci(filters.empresa);
  if (filters.responsable) where.responsable = { name: ci(filters.responsable) };
  if (filters.items || filters.item) {
    const term = ci(filters.items ?? filters.item)!.contains;
    where.items = {
      some: {
        OR: [
          { descripcion: { contains: term, mode: "insensitive" } },
          { marca: { contains: term, mode: "insensitive" } },
          { modelo: { contains: term, mode: "insensitive" } },
          { controlActivos: { contains: term, mode: "insensitive" } },
          { numeroSerie: { contains: term, mode: "insensitive" } },
        ],
      },
    };
  }

  const include = {
    items: { include: { device: { include: { type: true } } } },
    creadoPor: { select: { id: true, username: true, name: true } },
    responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
    encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
  };

  const orderBy = orderByOf(
    params.sort,
    {
      consecutivo: "consecutive",
      numeroEmpleado: "numeroEmpleado",
      departamento: "departamento",
      empresa: "empresa",
      fecha: "fecha",
      creadoEn: "creadoEn",
    },
    [{ creadoEn: "desc" }]
  );

  const [total, data] = await prismaClient.$transaction([
    prismaClient.cartaResponsiva.count({ where }),
    prismaClient.cartaResponsiva.findMany({
      where,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      include,
    }),
  ]);

  return { data, total };
};

export const getCartaById = async (id: string, userId?: string, role?: string) => {
  const carta = await prismaClient.cartaResponsiva.findUnique({
    where: { id },
    include: {
      items: { include: { device: { include: { type: true } } } },
      creadoPor: { select: { id: true, username: true, name: true } },
      responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
    },
  });
  if (!carta) throw new HttpError(404, `Carta ${id} no encontrada`);
  if (role === "EMPLEADO" && carta.responsableId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  return carta;
};

export const peekConsecutivo = async () => {
  const row = await prismaClient.consecutivo.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });
  return formatConsecutivo(row.prefijo, row.contador + 1);
};

const consumeConsecutivo = async (): Promise<string> => {
  const row = await prismaClient.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: { increment: 1 } },
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 1 },
  });
  return formatConsecutivo(row.prefijo, row.contador);
};

export const createCarta = async (input: CartaInput) => {
  const consecutivo = input.consecutivo || (await consumeConsecutivo());

  return prismaClient.$transaction(async (tx) => {
    // Auto-rellenar item desde el device si viene con deviceId
    const resolvedItem = await resolveItemFromDevice(tx, input.item);

    if (
      !resolvedItem.descripcion ||
      !resolvedItem.marca ||
      !resolvedItem.modelo ||
      !resolvedItem.controlActivos
    ) {
      throw new HttpError(
        400,
        "Faltan datos del dispositivo (descripcion/marca/modelo/controlActivos)"
      );
    }

    const carta = await tx.cartaResponsiva.create({
      data: {
        consecutive: consecutivo,
        fecha: input.fecha ? new Date(input.fecha) : new Date(),
        numeroEmpleado: input.numeroEmpleado,
        empresa: input.empresa ?? "Puerto Nuevo Hotel y Villas",
        departamento: input.departamento ?? "Departamento de Mantenimiento",
        creadoPorId: input.creadoPorId ?? null,
        responsableId: input.responsableId ?? null,
        encargadoId: input.encargadoId ?? null,
        areaBoss: input.areaBoss ?? null,
        deliveryBy: input.deliveryBy ?? "Departamento de Mantenimiento",
        items: {
          create: [
            {
              deviceId: resolvedItem.deviceId ?? null,
              descripcion: resolvedItem.descripcion,
              marca: resolvedItem.marca,
              modelo: resolvedItem.modelo,
              numeroSerie: resolvedItem.numeroSerie ?? "N/A",
              nombreEquipo: resolvedItem.nombreEquipo ?? "N/A",
              controlActivos: resolvedItem.controlActivos,
              area: resolvedItem.area ?? "MANTENIMIENTO",
            },
          ],
        },
      },
      include: {
        items: { include: { device: { include: { type: true } } } },
        creadoPor: { select: { id: true, username: true, name: true } },
        responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
        encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      },
    });

    // Status tracking: device pasa a ASIGNADO
    if (input.item.deviceId) {
      await tx.device.update({
        where: { id: input.item.deviceId },
        data: { estado: "ASIGNADO" },
      });
    }

    return carta;
  });
};

export const updateCarta = async (
  id: string,
  input: Partial<CartaInput>,
  userId?: string,
  role?: string
) => {
  const existing = await prismaClient.cartaResponsiva.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) throw new HttpError(404, `Carta ${id} no encontrada`);
  if (role === "EMPLEADO" && existing.responsableId !== userId) {
    throw new HttpError(403, "No autorizado");
  }

return prismaClient.$transaction(async (tx) => {
    const oldItems = await tx.cartaItem.findMany({ where: { cartaId: id } });

    let resolvedItem: CartaItemInput | null = null;
    if (input.item) {
      resolvedItem = await resolveItemFromDevice(tx, input.item);
      if (
        !resolvedItem.descripcion ||
        !resolvedItem.marca ||
        !resolvedItem.modelo ||
        !resolvedItem.controlActivos
      ) {
        throw new HttpError(
          400,
          "Faltan datos del dispositivo (descripcion/marca/modelo/controlActivos)"
        );
      }
      await tx.cartaItem.deleteMany({ where: { cartaId: id } });
    }

    const data: any = {
      consecutive: input.consecutivo ?? undefined,
      fecha: input.fecha ? new Date(input.fecha) : undefined,
      numeroEmpleado: input.numeroEmpleado ?? undefined,
      empresa: input.empresa ?? undefined,
      departamento: input.departamento ?? undefined,
      areaBoss: input.areaBoss ?? undefined,
      deliveryBy: input.deliveryBy ?? undefined,
    };
    if (input.responsableId !== undefined) data.responsableId = input.responsableId;
    if (input.encargadoId !== undefined) data.encargadoId = input.encargadoId;
    if (resolvedItem) {
      data.items = {
        create: [
          {
            deviceId: resolvedItem.deviceId ?? null,
            descripcion: resolvedItem.descripcion,
            marca: resolvedItem.marca,
            modelo: resolvedItem.modelo,
            numeroSerie: resolvedItem.numeroSerie ?? "N/A",
            nombreEquipo: resolvedItem.nombreEquipo ?? "N/A",
            controlActivos: resolvedItem.controlActivos,
            area: resolvedItem.area ?? "MANTENIMIENTO",
          },
        ],
      };
    }

    const carta = await tx.cartaResponsiva.update({
      where: { id },
      data,
      include: {
        items: { include: { device: { include: { type: true } } } },
        creadoPor: { select: { id: true, username: true, name: true } },
        responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
        encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      },
    });

    // Status tracking: si cambia deviceId, liberar el viejo y asignar el nuevo
    if (resolvedItem && resolvedItem.deviceId) {
      const oldDeviceIds = oldItems.map((i) => i.deviceId).filter(Boolean);
      for (const oldId of oldDeviceIds) {
        if (oldId !== resolvedItem.deviceId) {
          await tx.device.update({
            where: { id: oldId! },
            data: { estado: "DISPONIBLE" },
          });
        }
      }
      await tx.device.update({
        where: { id: resolvedItem.deviceId },
        data: { estado: "ASIGNADO" },
      });
    }

    return carta;
  });
};

export const deleteCarta = async (
  id: string,
  userId?: string,
  role?: string
) => {
  const existing = await prismaClient.cartaResponsiva.findUnique({
    where: { id },
  });
  if (!existing) throw new HttpError(404, "Carta no encontrada");
  if (role === "EMPLEADO" && existing.responsableId !== userId) {
    throw new HttpError(403, "No autorizado");
  }
  return prismaClient.cartaResponsiva.delete({ where: { id } });
};

export const resetConsecutivo = async () => {
  return prismaClient.consecutivo.upsert({
    where: { id: "singleton" },
    update: { contador: 0 },
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });
};

export const getConsecutivoState = async () => {
  const row = await prismaClient.consecutivo.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", prefijo: "F-MMTO-", contador: 0 },
  });
  return row;
};

export const returnCarta = async (
  id: string,
  data: { returnedBy: string; returnCondition: string },
  userId?: string,
  role?: string
) => {
  return prismaClient.$transaction(async (tx) => {
    const carta = await tx.cartaResponsiva.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!carta) throw new HttpError(404, "Carta no encontrada");
    if (role === "EMPLEADO" && carta.responsableId !== userId) {
      throw new HttpError(403, "No autorizado");
    }

    const updated = await tx.cartaResponsiva.update({
      where: { id },
      data: {
        returnDate: new Date(),
        returnedBy: data.returnedBy,
        returnCondition: data.returnCondition,
      },
      include: {
        items: { include: { device: { include: { type: true } } } },
        creadoPor: { select: { id: true, username: true, name: true } },
        responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
        encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      },
    });

    // Liberar device
    for (const item of carta.items) {
      if (item.deviceId) {
        await tx.device.update({
          where: { id: item.deviceId },
          data: { estado: "DISPONIBLE" },
        });
      }
    }

    return updated;
  });
};

export const undoReturnCarta = async (
  id: string,
  userId?: string,
  role?: string
) => {
  return prismaClient.$transaction(async (tx) => {
    const carta = await tx.cartaResponsiva.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!carta) throw new HttpError(404, "Carta no encontrada");
    if (role === "EMPLEADO" && carta.responsableId !== userId) {
      throw new HttpError(403, "No autorizado");
    }

    const updated = await tx.cartaResponsiva.update({
      where: { id },
      data: {
        returnDate: null,
        returnedBy: null,
        returnCondition: null,
      },
      include: {
        items: { include: { device: { include: { type: true } } } },
        creadoPor: { select: { id: true, username: true, name: true } },
        responsable: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
        encargado: { select: {
          id: true,
          name: true,
          puesto: true,
          numeroEmpleado: true,
          department: { select: { id: true, name: true } },
        } },
      },
    });

    // Re-asignar device
    for (const item of carta.items) {
      if (item.deviceId) {
        await tx.device.update({
          where: { id: item.deviceId },
          data: { estado: "ASIGNADO" },
        });
      }
    }

    return updated;
  });
};