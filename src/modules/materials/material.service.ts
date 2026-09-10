import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";

export const listMaterials = async (includeInactive = false) => {
  return prismaClient.material.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { modelo: "asc" },
  });
};

export const listMaterialsTable = async (
  params: ITDataTableFetchParams
): Promise<ITDataTableResponse<any>> => {
  const { filters } = params;
  const where: any = {};

  if (filters.categoria) where.categoria = ci(filters.categoria);
  if (filters.active !== undefined) where.active = Boolean(filters.active);
  if (filters.q) {
    const q = String(filters.q);
    where.OR = [
      { modelo: ci(q) },
      { descripcion: ci(q) },
      { marca: ci(q) },
      { categoria: ci(q) },
    ];
  }

  const orderBy = orderByOf(
    params.sort,
    {
      modelo: "modelo",
      categoria: "categoria",
      stock: "stock",
      createdAt: "createdAt",
    },
    [{ modelo: "asc" }]
  );

  const [total, data] = await prismaClient.$transaction([
    prismaClient.material.count({ where }),
    prismaClient.material.findMany({
      where,
      orderBy: orderBy as any,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { data, total };
};

export const getMaterialsSummary = async () => {
  const [total, categoriasRows, stockAgg] = await prismaClient.$transaction([
    prismaClient.material.count({ where: { active: true } }),
    prismaClient.material.findMany({
      where: { active: true },
      distinct: ["categoria"],
      select: { categoria: true },
    }),
    prismaClient.material.aggregate({
      where: { active: true },
      _sum: { stock: true },
    }),
  ]);
  return {
    total,
    categorias: categoriasRows.length,
    stockTotal: stockAgg._sum.stock ?? 0,
  };
};

export const listCategorias = async (): Promise<string[]> => {
  const rows = await prismaClient.material.findMany({
    where: { active: true },
    distinct: ["categoria"],
    select: { categoria: true },
    orderBy: { categoria: "asc" },
  });
  return rows.map((r: { categoria: string }) => r.categoria);
};

export const getMaterial = async (id: string) => {
  const m = await prismaClient.material.findUnique({
    where: { id },
    include: {
      history: {
        orderBy: { createdAt: "desc" },
        include: { autor: { select: { id: true, name: true, username: true } } },
      },
    },
  });
  if (!m) throw new HttpError(404, "Material no encontrado");
  return m;
};

// Busca un material existente por Modelo (sin distinguir mayúsculas/minúsculas
// ni espacios extra). Es la clave de "mismo modelo = mismo material" que usan
// tanto el alta manual como la carga masiva para decidir si suman stock a lo
// que ya existe o crean un renglón nuevo.
const findByModelo = (modelo: string) =>
  prismaClient.material.findFirst({
    where: { modelo: { equals: modelo.trim(), mode: "insensitive" } },
  });

export const createMaterial = async (
  data: {
    categoria: string;
    modelo: string;
    descripcion: string;
    marca?: string;
    stock?: number;
    unidad?: string;
  },
  autorId?: string
) => {
  const cantidad = data.stock ?? 0;
  const existing = await findByModelo(data.modelo);

  if (existing) {
    const nuevoStock = existing.stock + cantidad;
    const updated = await prismaClient.material.update({
      where: { id: existing.id },
      data: { stock: nuevoStock },
    });
    await prismaClient.materialHistory.create({
      data: {
        materialId: existing.id,
        type: "STOCK_ADDED",
        detail: `+${cantidad} (alta manual, mismo modelo "${existing.modelo}") · stock ${existing.stock} → ${nuevoStock}`,
        autorId: autorId ?? null,
      },
    });
    return updated;
  }

  const created = await prismaClient.material.create({
    data: {
      categoria: data.categoria.trim(),
      modelo: data.modelo.trim(),
      descripcion: data.descripcion.trim(),
      marca: data.marca?.trim() || null,
      stock: cantidad,
      unidad: data.unidad?.trim() || "PZA",
    },
  });
  await prismaClient.materialHistory.create({
    data: {
      materialId: created.id,
      type: "CREATED",
      detail: `Alta manual · stock inicial ${cantidad}`,
      autorId: autorId ?? null,
    },
  });
  return created;
};

export const updateMaterial = async (
  id: string,
  data: {
    categoria?: string;
    modelo?: string;
    descripcion?: string;
    marca?: string;
    stock?: number;
    unidad?: string;
    active?: boolean;
  },
  autorId?: string
) => {
  const existing = await prismaClient.material.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Material no encontrado");

  const updateData: any = {};
  if (data.categoria !== undefined) updateData.categoria = data.categoria.trim();
  if (data.modelo !== undefined) updateData.modelo = data.modelo.trim();
  if (data.descripcion !== undefined) updateData.descripcion = data.descripcion.trim();
  if (data.marca !== undefined) updateData.marca = data.marca?.trim() || null;
  if (data.unidad !== undefined) updateData.unidad = data.unidad.trim() || "PZA";
  if (data.active !== undefined) updateData.active = data.active;
  if (data.stock !== undefined) updateData.stock = data.stock;

  const updated = await prismaClient.material.update({ where: { id }, data: updateData });

  if (data.stock !== undefined && data.stock !== existing.stock) {
    await prismaClient.materialHistory.create({
      data: {
        materialId: id,
        type: "STOCK_ADJUSTED",
        detail: `Stock ajustado manualmente: ${existing.stock} → ${data.stock}`,
        autorId: autorId ?? null,
      },
    });
  }

  return updated;
};

export const deleteMaterial = async (id: string) => {
  const existing = await prismaClient.material.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Material no encontrado");

  if (existing.active) {
    const data = await prismaClient.material.update({
      where: { id },
      data: { active: false },
    });
    return { soft: true, data };
  }

  const data = await prismaClient.material.delete({ where: { id } });
  return { soft: false, data };
};

// === Carga masiva desde Excel ===

export interface MaterialImportRow {
  modelo: string;
  descripcion: string;
  cantidad: number;
}

export interface MaterialImportResult {
  creados: number;
  actualizados: number;
  omitidos: { fila: number; motivo: string }[];
  detalle: { modelo: string; accion: "creado" | "sumado"; stockFinal: number }[];
}

export const importMaterials = async (
  rows: MaterialImportRow[],
  categoria: string,
  autorId?: string
): Promise<MaterialImportResult> => {
  const result: MaterialImportResult = {
    creados: 0,
    actualizados: 0,
    omitidos: [],
    detalle: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fila = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1

    if (!row.modelo?.trim() || !row.descripcion?.trim()) {
      result.omitidos.push({ fila, motivo: "Falta Modelo o Descripción" });
      continue;
    }

    const cantidad = Number.isFinite(row.cantidad) ? Math.max(0, Math.trunc(row.cantidad)) : 0;
    const existing = await findByModelo(row.modelo);

    if (existing) {
      const nuevoStock = existing.stock + cantidad;
      await prismaClient.material.update({
        where: { id: existing.id },
        data: { stock: nuevoStock },
      });
      await prismaClient.materialHistory.create({
        data: {
          materialId: existing.id,
          type: "IMPORTED",
          detail: `Carga Excel (fila ${fila}): +${cantidad} · stock ${existing.stock} → ${nuevoStock}`,
          autorId: autorId ?? null,
        },
      });
      result.actualizados += 1;
      result.detalle.push({ modelo: row.modelo, accion: "sumado", stockFinal: nuevoStock });
    } else {
      const created = await prismaClient.material.create({
        data: {
          categoria: categoria.trim(),
          modelo: row.modelo.trim(),
          descripcion: row.descripcion.trim(),
          stock: cantidad,
        },
      });
      await prismaClient.materialHistory.create({
        data: {
          materialId: created.id,
          type: "IMPORTED",
          detail: `Carga Excel (fila ${fila}) · stock inicial ${cantidad}`,
          autorId: autorId ?? null,
        },
      });
      result.creados += 1;
      result.detalle.push({ modelo: row.modelo, accion: "creado", stockFinal: cantidad });
    }
  }

  return result;
};
