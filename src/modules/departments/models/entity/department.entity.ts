import type { Subarea } from "@prisma/client";

export interface DepartmentEntity {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  subareas?: Subarea[];
  _count?: { users: number };
}

export interface SubareaEntity extends Subarea {}