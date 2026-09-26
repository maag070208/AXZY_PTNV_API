import { publicObjectUrl } from "@core/services/storage";
import type { PersonalProfile, EmployeeDocument } from "../models/dto/hr.dto";
import type { PersonalProfileEntity, EmployeeDocumentEntity } from "../models/entity/hr.entity";

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
  jobTitle: entity.jobTitle,
  employeeNumber: entity.employeeNumber,
  company: entity.company,
  department: entity.department,
  subarea: entity.subarea,

  middleName: entity.middleName,
  paternalSurname: entity.paternalSurname,
  maternalSurname: entity.maternalSurname,
  photoUrl: safeUrl(entity.photoKey),

  gender: entity.gender,
  bloodType: entity.bloodType,
  medicalConditions: entity.medicalConditions,
  allergies: entity.allergies,

  birthDate: dateOnly(entity.birthDate),
  hireDate: dateOnly(entity.hireDate),

  rfc: entity.rfc,
  curp: entity.curp,
  nss: entity.nss,

  streetAddress: entity.streetAddress,
  neighborhood: entity.neighborhood,
  postalCode: entity.postalCode,
  city: entity.city,
  addressState: entity.addressState,
  country: entity.country,

  personalPhone: entity.personalPhone,
  workPhone: entity.workPhone,

  emergencyContactName: entity.emergencyContactName,
  emergencyContactPhone: entity.emergencyContactPhone,
  emergencyContactRelationship: entity.emergencyContactRelationship,

  discounts: entity.discounts,

  createdAt: entity.createdAt.toISOString(),
});

export const employeeDocumentToDto = (entity: EmployeeDocumentEntity): EmployeeDocument => ({
  id: entity.id,
  documentTypeId: entity.documentTypeId,
  documentType: entity.documentType,
  originalName: entity.originalName,
  mimeType: entity.mimeType,
  sizeBytes: entity.sizeBytes,
  url: publicObjectUrl(entity.storageKey),
  uploadedById: entity.uploadedById,
  createdAt: entity.createdAt.toISOString(),
});
