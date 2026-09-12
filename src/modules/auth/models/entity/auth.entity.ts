import type { Role } from "@prisma/client";

export interface AuthUserEntity {
  id: string;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  departmentId: string | null;
  active: boolean;
  password: string;
}