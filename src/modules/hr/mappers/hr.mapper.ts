import { publicObjectUrl } from "@core/services/storage";
import type { PersonalProfile, EmployeeDocument } from "../models/dto/personal.dto";
import type { PersonalProfileEntity, EmployeeDocumentEntity } from "../models/entity/personal.entity";

const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/** publicObjectUrl lanza si el storage no está configurado; degradamos a null en vez de tronar la respuesta. */
const safeUrl = (key: string | null): string | null => {
  if (!key) return null;
  try {
    return publicObjectUrl(key);
  } catch {
    return null;
  }
};

export const personalProfileToDto = (entity: PersonalProfileEntity): PersonalProfile => ({
  id: entity.id,
  username: entity.username,
  name: entity.name,
  email: entity.email,
  role: entity.role,
  active: entity.active,
  puesto: entity.puesto,
  numeroEmpleado: entity.numeroEmpleado,
  empresa: entity.empresa,
  department: entity.department,
  subarea: entity.subarea,

  segundoNombre: entity.segundoNombre,
  apellidoPaterno: entity.apellidoPaterno,
  apellidoMaterno: entity.apellidoMaterno,
  fotoUrl: safeUrl(entity.fotoKey),

  genero: entity.genero,
  tipoSangre: entity.tipoSangre,
  padecimiento: entity.padecimiento,
  alergias: entity.alergias,

  fechaNacimiento: dateOnly(entity.fechaNacimiento),
  fechaIngreso: dateOnly(entity.fechaIngreso),

  rfc: entity.rfc,
  curp: entity.curp,
  nss: entity.nss,

  calleNumero: entity.calleNumero,
  colonia: entity.colonia,
  codigoPostal: entity.codigoPostal,
  ciudad: entity.ciudad,
  estadoDireccion: entity.estadoDireccion,
  pais: entity.pais,

  celularPersonal: entity.celularPersonal,
  celularEmpresa: entity.celularEmpresa,

  contactoEmergenciaNombre: entity.contactoEmergenciaNombre,
  contactoEmergenciaTelefono: entity.contactoEmergenciaTelefono,
  contactoEmergenciaParentesco: entity.contactoEmergenciaParentesco,

  discounts: entity.discounts,

  createdAt: entity.createdAt.toISOString(),
});

export const employeeDocumentToDto = (entity: EmployeeDocumentEntity): EmployeeDocument => ({
  id: entity.id,
  tipoDocumentoId: entity.tipoDocumentoId,
  tipoDocumento: entity.tipoDocumento,
  originalName: entity.originalName,
  mimeType: entity.mimeType,
  sizeBytes: entity.sizeBytes,
  url: publicObjectUrl(entity.storageKey),
  uploadedById: entity.uploadedById,
  createdAt: entity.createdAt.toISOString(),
});
