import type {
  Subarea,
  TicketStatus,
  TicketPriority,
} from "@prisma/client";

export interface DepartmentTicketEntity {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  category?: { id: string; name: string } | null;
  createdAt: Date;
  assignedTo?: { id: string; name: string } | null;
}

export interface DepartmentCustodyLetterEntity {
  id: string;
  consecutive: string;
  date: Date;
  returnDate: Date | null;
  custodian?: { id: string; name: string } | null;
  supervisor?: { id: string; name: string } | null;
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
  custodyLetters?: DepartmentCustodyLetterEntity[];
  custodyLettersTotal?: number;
  _count?: { users: number };
}

export interface SubareaEntity extends Subarea {}
