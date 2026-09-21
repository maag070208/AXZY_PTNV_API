import type { ActaAdministrativa } from "../models/dto/acta.dto";
import type { ActaAdministrativaEntity } from "../models/entity/acta.entity";

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

export const actaAdministrativaToDto = (entity: ActaAdministrativaEntity): ActaAdministrativa => ({
  id: entity.id,
  motivo: entity.motivo,
  fechaIncidente: dateOnly(entity.fechaIncidente),
  descripcion: entity.descripcion,
  sancion: entity.sancion,
  createdAt: entity.createdAt.toISOString(),
  user: {
    id: entity.user.id,
    name: entity.user.name,
    numeroEmpleado: entity.user.numeroEmpleado,
    puesto: entity.user.puesto,
    department: entity.user.department,
    subarea: entity.user.subarea,
  },
  createdBy: {
    id: entity.createdBy.id,
    name: entity.createdBy.name,
  },
});