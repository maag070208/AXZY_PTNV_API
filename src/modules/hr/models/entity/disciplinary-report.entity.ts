import type { Prisma } from "@prisma/client";

export const actaAdministrativaInclude = {
  user: {
    select: {
      id: true,
      name: true,
      numeroEmpleado: true,
      puesto: true,
      department: { select: { id: true, name: true } },
      subarea: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CartaAdministrativaInclude;

export type ActaAdministrativaEntity = Prisma.CartaAdministrativaGetPayload<{
  include: typeof actaAdministrativaInclude;
}>;