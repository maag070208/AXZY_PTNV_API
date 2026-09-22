import { z, registry } from "@core/swagger/registry";
import { paginatedTableResponseSchema } from "@core/swagger/table.dto";

const RoleSchema = z.enum(["ADMIN", "GERENTE", "JEFE_DE_AREA", "EMPLEADO", "RECURSOS_HUMANOS"]);
const TipoDescuentoSchema = z.enum(["INFONAVIT", "IMSS", "DEUDOR_ALIMENTICIO"]);

export const GeneroSchema = z
  .object({ id: z.string(), nombre: z.string(), activo: z.boolean() })
  .openapi("Genero");

export const TipoSangreSchema = z
  .object({ id: z.string(), nombre: z.string(), activo: z.boolean() })
  .openapi("TipoSangre");

export const TipoDocumentoSchema = z
  .object({
    id: z.string(),
    nombre: z.string(),
    activo: z.boolean(),
    orden: z.number(),
    createdAt: z.string(),
  })
  .openapi("TipoDocumento");

export const GeneroCreateDto = z
  .object({ nombre: z.string().min(1) })
  .openapi("GeneroCreateInput");
export type GeneroCreateInput = z.infer<typeof GeneroCreateDto>;

export const GeneroUpdateDto = z
  .object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() })
  .openapi("GeneroUpdateInput");
export type GeneroUpdateInput = z.infer<typeof GeneroUpdateDto>;

export const TipoSangreCreateDto = z
  .object({ nombre: z.string().min(1) })
  .openapi("TipoSangreCreateInput");
export type TipoSangreCreateInput = z.infer<typeof TipoSangreCreateDto>;

export const TipoSangreUpdateDto = z
  .object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() })
  .openapi("TipoSangreUpdateInput");
export type TipoSangreUpdateInput = z.infer<typeof TipoSangreUpdateDto>;

export const TipoDocumentoCreateDto = z
  .object({ nombre: z.string().min(1), orden: z.number().optional() })
  .openapi("TipoDocumentoCreateInput");
export type TipoDocumentoCreateInput = z.infer<typeof TipoDocumentoCreateDto>;

export const TipoDocumentoUpdateDto = z
  .object({
    nombre: z.string().min(1).optional(),
    activo: z.boolean().optional(),
    orden: z.number().optional(),
  })
  .openapi("TipoDocumentoUpdateInput");
export type TipoDocumentoUpdateInput = z.infer<typeof TipoDocumentoUpdateDto>;

export const EmployeeDiscountSchema = z
  .object({ tipo: TipoDescuentoSchema, nota: z.string().nullish() })
  .openapi("EmployeeDiscount");

export const EmployeeDiscountsSetDto = z
  .object({
    discounts: z.array(z.object({ tipo: TipoDescuentoSchema, nota: z.string().optional() })),
  })
  .openapi("EmployeeDiscountsSetInput");
export type EmployeeDiscountsSetInput = z.infer<typeof EmployeeDiscountsSetDto>;

export const EmployeeDocumentSchema = z
  .object({
    id: z.string(),
    tipoDocumentoId: z.string(),
    tipoDocumento: z.object({ id: z.string(), nombre: z.string() }),
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
    activos: z.number(),
    inactivos: z.number(),
    roles: z.object({ GERENTE: z.number(), JEFE_DE_AREA: z.number(), EMPLEADO: z.number() }),
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
    puesto: z.string().nullish(),
    numeroEmpleado: z.string().nullish(),
    empresa: z.string().nullish(),
    department: z.object({ id: z.string(), name: z.string() }).nullish(),
    subarea: z.object({ id: z.string(), name: z.string() }).nullish(),

    segundoNombre: z.string().nullish(),
    apellidoPaterno: z.string().nullish(),
    apellidoMaterno: z.string().nullish(),
    fotoUrl: z.string().nullish(),

    genero: GeneroSchema.nullish(),
    tipoSangre: TipoSangreSchema.nullish(),
    padecimiento: z.string().nullish(),
    alergias: z.string().nullish(),

    fechaNacimiento: z.string().nullish(),
    fechaIngreso: z.string().nullish(),

    rfc: z.string().nullish(),
    curp: z.string().nullish(),
    nss: z.string().nullish(),

    calleNumero: z.string().nullish(),
    colonia: z.string().nullish(),
    codigoPostal: z.string().nullish(),
    ciudad: z.string().nullish(),
    estadoDireccion: z.string().nullish(),
    pais: z.string().nullish(),

    celularPersonal: z.string().nullish(),
    celularEmpresa: z.string().nullish(),

    contactoEmergenciaNombre: z.string().nullish(),
    contactoEmergenciaTelefono: z.string().nullish(),
    contactoEmergenciaParentesco: z.string().nullish(),

    discounts: z.array(EmployeeDiscountSchema),

    createdAt: z.string(),
  })
  .openapi("PersonalProfile");
export type PersonalProfile = z.infer<typeof PersonalProfileSchema>;

export const PersonalProfileUpdateDto = z
  .object({
    segundoNombre: z.string().nullable().optional(),
    apellidoPaterno: z.string().nullable().optional(),
    apellidoMaterno: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),

    generoId: z.string().nullable().optional(),
    tipoSangreId: z.string().nullable().optional(),
    padecimiento: z.string().nullable().optional(),
    alergias: z.string().nullable().optional(),

    fechaNacimiento: z.string().nullable().optional(),
    fechaIngreso: z.string().nullable().optional(),

    rfc: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v), {
        message: "RFC inválido",
      }),
    curp: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^[A-Z]{4}\d{6}[A-Z0-9]{8}$/i.test(v), {
        message: "CURP debe tener 18 caracteres alfanuméricos",
      }),
    nss: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^\d{11}$/.test(v), {
        message: "NSS debe tener 11 dígitos",
      }),

    calleNumero: z.string().nullable().optional(),
    colonia: z.string().nullable().optional(),
    codigoPostal: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v === "" || /^\d{5}$/.test(v), {
        message: "Código postal debe tener 5 dígitos",
      }),
    ciudad: z.string().nullable().optional(),
    estadoDireccion: z.string().nullable().optional(),
    pais: z.string().nullable().optional(),

    celularPersonal: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "Teléfono debe tener entre 10 y 13 dígitos" }
      ),
    celularEmpresa: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "Teléfono debe tener entre 10 y 13 dígitos" }
      ),

    contactoEmergenciaNombre: z.string().nullable().optional(),
    contactoEmergenciaTelefono: z
      .string()
      .nullable()
      .optional()
      .refine(
        (v) => {
          if (v == null || v === "") return true;
          const digits = v.replace(/[^\d]/g, "");
          return digits.length >= 10 && digits.length <= 13;
        },
        { message: "Teléfono debe tener entre 10 y 13 dígitos" }
      ),
    contactoEmergenciaParentesco: z.string().nullable().optional(),
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
registry.register("TipoDocumento", TipoDocumentoSchema);
registry.register("TipoDocumentoCreateInput", TipoDocumentoCreateDto);
registry.register("TipoDocumentoUpdateInput", TipoDocumentoUpdateDto);
registry.register("Genero", GeneroSchema);
registry.register("GeneroCreateInput", GeneroCreateDto);
registry.register("GeneroUpdateInput", GeneroUpdateDto);
registry.register("TipoSangre", TipoSangreSchema);
registry.register("TipoSangreCreateInput", TipoSangreCreateDto);
registry.register("TipoSangreUpdateInput", TipoSangreUpdateDto);
registry.register("PersonalStats", PersonalStatsSchema);
registry.register("PersonalTableResponse", PersonalTableResponseSchema);
