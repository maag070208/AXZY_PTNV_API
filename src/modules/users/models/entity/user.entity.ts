import type { Role } from "@prisma/client";

export interface UserEntity {
  id: string;
  username: string;
  email: string | null;
  name: string;
  middleName: string | null;
  paternalSurname: string | null;
  maternalSurname: string | null;
  role: Role;
  active: boolean;
  jobTitle: string | null;
  employeeNumber: string | null;
  company: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  subareaId: string | null;
  subarea?: { id: string; name: string } | null;
  createdAt: Date;
}

export interface UserHistoryEntryEntity {
  id: string;
  type:
    | "LOAN_CUSTODIAN"
    | "MOVEMENT"
    | "TICKET_CREATED"
    | "TICKET_ASSIGNED"
    | "TICKET_COMMENT"
    | "USER_DEACTIVATED"
    | "USER_REACTIVATED";
  title: string;
  detail: string;
  timestamp: Date;
  refId?: string;
}