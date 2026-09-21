import type { Role } from "@prisma/client";

export interface UserEntity {
  id: string;
  username: string;
  email: string | null;
  name: string;
  segundoNombre: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
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
    | "PRESTAMO_RESPONSABLE"
    | "MOVIMIENTO"
    | "TICKET_CREADO"
    | "TICKET_ASIGNADO"
    | "TICKET_COMENTARIO";
  title: string;
  detail: string;
  timestamp: Date;
  refId?: string;
}