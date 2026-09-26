import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

const RoleSchema = z.enum([
  "ADMIN",
  "MANAGER",
  "AREA_HEAD",
  "EMPLOYEE",
  "HUMAN_RESOURCES",
  "GUARD",
]);
const DiscountTypeSchema = z.enum(["INFONAVIT", "IMSS", "CHILD_SUPPORT"]);

export const GenderSchema = z
  .object({ id: z.string(), name: z.string(), active: z.boolean() })
  .openapi("Gender");

export const BloodTypeSchema = z
  .object({ id: z.string(), name: z.string(), active: z.boolean() })
  .openapi("BloodType");

export const DocumentTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    sortOrder: z.number(),
    createdAt: z.string(),
  })
  .openapi("DocumentType");

export const GenderCreateDto = z
  .object({ name: z.string().min(1) })
  .openapi("GenderCreateInput");
export type GenderCreateInput = z.infer<typeof GenderCreateDto>;

export const GenderUpdateDto = z
  .object({ name: z.string().min(1).optional(), active: z.boolean().optional() })
  .openapi("GenderUpdateInput");
export type GenderUpdateInput = z.infer<typeof GenderUpdateDto>;

export const BloodTypeCreateDto = z
  .object({ name: z.string().min(1) })
  .openapi("BloodTypeCreateInput");
export type BloodTypeCreateInput = z.infer<typeof BloodTypeCreateDto>;

export const BloodTypeUpdateDto = z
  .object({ name: z.string().min(1).optional(), active: z.boolean().optional() })
  .openapi("BloodTypeUpdateInput");
export type BloodTypeUpdateInput = z.infer<typeof BloodTypeUpdateDto>;

export const DocumentTypeCreateDto = z
  .object({ name: z.string().min(1), sortOrder: z.number().optional() })
  .openapi("DocumentTypeCreateInput");
export type DocumentTypeCreateInput = z.infer<typeof DocumentTypeCreateDto>;

export const DocumentTypeUpdateDto = z
  .object({
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().optional(),
  })
  .openapi("DocumentTypeUpdateInput");
export type DocumentTypeUpdateInput = z.infer<typeof DocumentTypeUpdateDto>;

export const EmployeeDiscountSchema = z
  .object({ type: DiscountTypeSchema, note: z.string().nullish() })
  .openapi("EmployeeDiscount");

export const EmployeeDiscountsSetDto = z
  .object({
    discounts: z.array(z.object({ type: DiscountTypeSchema, note: z.string().optional() })),
  })
  .openapi("EmployeeDiscountsSetInput");
export type EmployeeDiscountsSetInput = z.infer<typeof EmployeeDiscountsSetDto>;

export const EmployeeDocumentSchema = z
  .object({
    id: z.string(),
    documentTypeId: z.string(),
    documentType: z.object({ id: z.string(), name: z.string() }),
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    url: z.string(),
    uploadedById: z.string(),
    createdAt: z.string(),
  })
  .openapi("EmployeeDocument");
export type EmployeeDocument = z.infer<typeof EmployeeDocumentSchema>;

export const PersonalStatsSchema = z
  .object({
    total: z.number(),
    active: z.number(),
    inactive: z.number(),
    roles: z.object({ MANAGER: z.number(), AREA_HEAD: z.number(), EMPLOYEE: z.number() }),
  })
  .openapi("PersonalStats");

export const PersonalProfileSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    email: z.string().nullish(),
    role: RoleSchema,
    active: z.boolean(),
    jobTitle: z.string().nullish(),
    employeeNumber: z.string().nullish(),
    company: z.string().nullish(),
    department: z.object({ id: z.string(), name: z.string() }).nullish(),
    subarea: z.object({ id: z.string(), name: z.string() }).nullish(),

    middleName: z.string().nullish(),
    paternalSurname: z.string().nullish(),
    maternalSurname: z.string().nullish(),
    photoUrl: z.string().nullish(),

    gender: GenderSchema.nullish(),
    bloodType: BloodTypeSchema.nullish(),
    medicalConditions: z.string().nullish(),
    allergies: z.string().nullish(),

    birthDate: z.string().nullish(),
    hireDate: z.string().nullish(),

    rfc: z.string().nullish(),
    curp: z.string().nullish(),
    nss: z.string().nullish(),

    streetAddress: z.string().nullish(),
    neighborhood: z.string().nullish(),
    postalCode: z.string().nullish(),
    city: z.string().nullish(),
    addressState: z.string().nullish(),
    country: z.string().nullish(),

    personalPhone: z.string().nullish(),
    workPhone: z.string().nullish(),

    emergencyContactName: z.string().nullish(),
    emergencyContactPhone: z.string().nullish(),
    emergencyContactRelationship: z.string().nullish(),

    discounts: z.array(EmployeeDiscountSchema),

    createdAt: z.string(),
  })
  .openapi("PersonalProfile");
export type PersonalProfile = z.infer<typeof PersonalProfileSchema>;

export const PersonalProfileUpdateDto = z
  .object({
    middleName: z.string().nullable().optional(),
    paternalSurname: z.string().nullable().optional(),
    maternalSurname: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),

    genderId: z.string().nullable().optional(),
    bloodTypeId: z.string().nullable().optional(),
    medicalConditions: z.string().nullable().optional(),
    allergies: z.string().nullable().optional(),

    birthDate: z.string().nullable().optional(),
    hireDate: z.string().nullable().optional(),

    rfc: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v), {
        message: "INVALID_RFC",
      }),
    curp: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^[A-Z]{4}\d{6}[A-Z0-9]{8}$/i.test(v), {
        message: "INVALID_CURP",
      }),
    nss: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^\d{11}$/.test(v), {
        message: "INVALID_NSS",
      }),

    streetAddress: z.string().nullable().optional(),
    neighborhood: z.string().nullable().optional(),
    postalCode: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^\d{5}$/.test(v), {
        message: "INVALID_POSTAL_CODE",
      }),
    city: z.string().nullable().optional(),
    addressState: z.string().nullable().optional(),
    country: z.string().nullable().optional(),

    personalPhone: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "INVALID_PHONE" }
      ),
    workPhone: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "INVALID_PHONE" }
      ),

    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "INVALID_PHONE" }
      ),
    emergencyContactRelationship: z.string().nullable().optional(),
  })
  .openapi("PersonalProfileUpdateInput");
export type PersonalProfileUpdateInput = z.infer<typeof PersonalProfileUpdateDto>;

export const PersonalTableResponseSchema = paginatedTableResponseSchema(
  PersonalProfileSchema,
  "PersonalTableResponse"
);

registry.register("PersonalProfile", PersonalProfileSchema);
registry.register("PersonalProfileUpdateInput", PersonalProfileUpdateDto);
registry.register("EmployeeDiscount", EmployeeDiscountSchema);
registry.register("EmployeeDiscountsSetInput", EmployeeDiscountsSetDto);
registry.register("EmployeeDocument", EmployeeDocumentSchema);
registry.register("DocumentType", DocumentTypeSchema);
registry.register("DocumentTypeCreateInput", DocumentTypeCreateDto);
registry.register("DocumentTypeUpdateInput", DocumentTypeUpdateDto);
registry.register("Gender", GenderSchema);
registry.register("GenderCreateInput", GenderCreateDto);
registry.register("GenderUpdateInput", GenderUpdateDto);
registry.register("BloodType", BloodTypeSchema);
registry.register("BloodTypeCreateInput", BloodTypeCreateDto);
registry.register("BloodTypeUpdateInput", BloodTypeUpdateDto);
registry.register("PersonalStats", PersonalStatsSchema);
registry.register("PersonalTableResponse", PersonalTableResponseSchema);
