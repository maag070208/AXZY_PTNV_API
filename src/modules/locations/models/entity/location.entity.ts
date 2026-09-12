import type { Device } from "@prisma/client";

export interface LocationEntity {
  id: string;
  lugar: string | null;
  subLugar: string | null;
  numero: string | null;
  descripcion: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { devices: number };
  devices?: (Device & { type?: unknown })[];
}

export interface LocationCreateInput {
  lugar?: string;
  subLugar?: string;
  numero?: string;
  descripcion?: string;
}

export interface LocationUpdateInput extends LocationCreateInput {}