import type { Prisma, PrismaClient } from "@prisma/client";
import { toUtcDate } from "./workday-rules";

const withSchedule = { schedule: { include: { days: true } } } as const;

export type LoadedAssignment = Prisma.ScheduleAssignmentGetPayload<{ include: typeof withSchedule }>;

/**
 * Asignaciones de horario (con sus días) que tocan `[start, end)` para las
 * personas dadas, en orden de vigencia. Una sola consulta para el periodo; el
 * horario de cada día lo resuelve `scheduleOn`.
 */
export const loadScheduleAssignments = async (
  db: PrismaClient,
  userIds: string[],
  range: { start: Date; end: Date }
): Promise<LoadedAssignment[]> =>
  userIds.length === 0
    ? []
    : db.scheduleAssignment.findMany({
        where: {
          userId: { in: userIds },
          validFrom: { lt: range.end },
          OR: [{ validTo: null }, { validTo: { gte: range.start } }],
        },
        include: withSchedule,
        orderBy: { validFrom: "asc" },
      });

/**
 * Horario vigente de la persona en el día local `dayKey` (`validFrom`/`validTo`
 * se guardan como UTC-medianoche del día); con vigencias encimadas gana la más
 * antigua. `null` = sin horario ese día.
 */
export const scheduleOn = (assignments: LoadedAssignment[], userId: string, dayKey: string) => {
  const dayMs = toUtcDate(dayKey).getTime();
  const assignment = assignments.find(
    (a) => a.userId === userId && a.validFrom.getTime() <= dayMs && (!a.validTo || a.validTo.getTime() >= dayMs)
  );
  return assignment?.schedule ?? null;
};
