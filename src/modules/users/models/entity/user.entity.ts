import type { Role } from "@prisma/client";

export interface UserEntity {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  active: boolean;
  puesto: string | null;
  numeroEmpleado: string | null;
  empresa: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  subareaId: string | null;
  subarea?: { id: string; name: string } | null;
  createdAt: Date;
}

export interface UserHistoryEntryEntity {
  id: string;
  type:
    | "CARTA_CREADA"
    | "CARTA_RESPONSABLE"
    | "CARTA_ENCARGADO"
    | "TICKET_CREADO"
    | "TICKET_ASIGNADO"
    | "TICKET_COMENTARIO"
    | "DISPOSITIVO_HISTORIAL";
  title: string;
  detail: string;
  timestamp: Date;
  refId?: string;
}