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
  _count: entity._count,
});

export const subareaToDto = (subarea: Subarea): NonNullable<Department["subareas"]>[number] => ({
  id: subarea.id,
  departmentId: subarea.departmentId,
  name: subarea.name,
  active: subarea.active,
  createdAt: subarea.createdAt.toISOString(),
});