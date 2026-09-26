import type { Prisma } from "@prisma/client";

export const personalProfileInclude = {
  department: { select: { id: true, name: true } },
  subarea: { select: { id: true, name: true } },
  genero: { select: { id: true, nombre: true, activo: true } },
  tipoSangre: { select: { id: true, nombre: true, activo: true } },
  discounts: { select: { tipo: true, nota: true } },
} satisfies Prisma.UserInclude;

export type PersonalProfileEntity = Prisma.UserGetPayload<{
  include: typeof personalProfileInclude;
}>;

export const employeeDocumentInclude = {
  tipoDocumento: { select: { id: true, nombre: true } },
} satisfies Prisma.EmployeeDocumentInclude;

export type EmployeeDocumentEntity = Prisma.EmployeeDocumentGetPayload<{
  include: typeof employeeDocumentInclude;
}>;
