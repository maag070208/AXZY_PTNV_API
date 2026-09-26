import type { Prisma } from "@prisma/client";

export const disciplinaryReportInclude = {
  user: {
    select: {
      id: true,
      name: true,
      employeeNumber: true,
      jobTitle: true,
      department: { select: { id: true, name: true } },
      subarea: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.DisciplinaryReportInclude;

export type DisciplinaryReportEntity = Prisma.DisciplinaryReportGetPayload<{
  include: typeof disciplinaryReportInclude;
}>;