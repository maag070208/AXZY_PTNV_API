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
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: t.category?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    assignedTo: t.assignedTo,
  })),
  ticketsTotal: entity.ticketsTotal,
  custodyLetters: entity.custodyLetters?.map((c) => ({
    id: c.id,
    consecutive: c.consecutive,
    date: c.date.toISOString(),
    returnDate: c.returnDate ? c.returnDate.toISOString() : null,
    custodian: c.custodian,
    supervisor: c.supervisor,
    itemsCount: c.itemsCount,
  })),
  custodyLettersTotal: entity.custodyLettersTotal,
  _count: entity._count,
});

export const subareaToDto = (subarea: Subarea): NonNullable<Department["subareas"]>[number] => ({
  id: subarea.id,
  departmentId: subarea.departmentId,
  name: subarea.name,
  active: subarea.active,
  createdAt: subarea.createdAt.toISOString(),
});
