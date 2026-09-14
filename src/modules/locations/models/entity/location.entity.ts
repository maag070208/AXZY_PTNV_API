import type { Device } from "@prisma/client";

export interface Sublugar {
  id: string;
  locationId: string;
  name: string;
  numero: string | null;
  active: boolean;
  createdAt: Date;
}

export interface LocationEntity {
  id: string;
  lugar: string;
  active: boolean;
  descripcion: string | null;
  departmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { devices: number; cartas: number };
  sublugares?: Sublugar[];
  devices?: (Device & { type?: unknown })[];
}

export interface LocationCreateInput {
  lugar: string;
  descripcion?: string;
  active?: boolean;
}

export interface LocationUpdateInput {
  lugar?: string;
  descripcion?: string;
  active?: boolean;
}

export interface SublugarCreateInput {
  name: string;
  numero?: string;
}