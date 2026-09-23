import type { Subarea } from "@prisma/client";
import type { Department } from "../models/dto/department.dto";
import type { DepartmentEntity } from "../models/entity/department.entity";

export const departmentToDto = (entity: DepartmentEntity): Department => ({
  id: entity.id,
  name: entity.name,
  active: entity.active,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  subareas: entity.subareas?.map(subareaToDto),
  tickets: entity.tickets?.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    status: t.status,
    priority: t.priority,
    category: t.category?.nombre ?? null,
    creadoEn: t.creadoEn.toISOString(),
    asignadoA: t.asignadoA,
  })),
  ticketsTotal: entity.ticketsTotal,
  cartas: entity.cartas?.map((c) => ({
    id: c.id,
    consecutive: c.consecutive,
    fecha: c.fecha.toISOString(),
    returnDate: c.returnDate ? c.returnDate.toISOString() : null,
    responsable: c.responsable,
    encargado: c.encargado,
    itemsCount: c.itemsCount,
  })),
  cartasTotal: entity.cartasTotal,
  _count: entity._count,
});

export const subareaToDto = (subarea: Subarea): NonNullable<Department["subareas"]>[number] => ({
  id: subarea.id,
  departmentId: subarea.departmentId,
  name: subarea.name,
  active: subarea.active,
  createdAt: subarea.createdAt.toISOString(),
});
