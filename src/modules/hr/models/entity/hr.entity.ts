import type { Prisma } from "@prisma/client";

export const personalProfileInclude = {
  department: { select: { id: true, name: true } },
  subarea: { select: { id: true, name: true } },
  gender: { select: { id: true, name: true, active: true } },
  bloodType: { select: { id: true, name: true, active: true } },
  discounts: { select: { type: true, note: true } },
} satisfies Prisma.UserInclude;

export type PersonalProfileEntity = Prisma.UserGetPayload<{
  include: typeof personalProfileInclude;
}>;

export const employeeDocumentInclude = {
  documentType: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeDocumentInclude;

export type EmployeeDocumentEntity = Prisma.EmployeeDocumentGetPayload<{
  include: typeof employeeDocumentInclude;
}>;
