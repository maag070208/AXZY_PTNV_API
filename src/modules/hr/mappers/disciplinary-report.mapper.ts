import type { DisciplinaryReport } from "../models/dto/disciplinary-report.dto";
import type { DisciplinaryReportEntity } from "../models/entity/disciplinary-report.entity";

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

export const disciplinaryReportToDto = (entity: DisciplinaryReportEntity): DisciplinaryReport => ({
  id: entity.id,
  reason: entity.reason,
  incidentDate: dateOnly(entity.incidentDate),
  description: entity.description,
  sanction: entity.sanction,
  createdAt: entity.createdAt.toISOString(),
  user: {
    id: entity.user.id,
    name: entity.user.name,
    employeeNumber: entity.user.employeeNumber,
    jobTitle: entity.user.jobTitle,
    department: entity.user.department,
    subarea: entity.user.subarea,
  },
  createdBy: {
    id: entity.createdBy.id,
    name: entity.createdBy.name,
  },
});