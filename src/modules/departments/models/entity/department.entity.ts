import type {
  Subarea,
  TicketStatus,
  TicketPriority,
  TicketCategory,
} from "@prisma/client";

export interface DepartmentTicketEntity {
  id: string;
  titulo: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  creadoEn: Date;
  asignadoA?: { id: string; name: string } | null;
}

export interface DepartmentCartaEntity {
  id: string;
  consecutive: string;
  fecha: Date;
  returnDate: Date | null;
  responsable?: { id: string; name: string } | null;
  encargado?: { id: string; name: string } | null;
  itemsCount: number;
}

export interface DepartmentEntity {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  subareas?: Subarea[];
  tickets?: DepartmentTicketEntity[];
  ticketsTotal?: number;
  cartas?: DepartmentCartaEntity[];
  cartasTotal?: number;
  _count?: { users: number };
}

export interface SubareaEntity extends Subarea {}
