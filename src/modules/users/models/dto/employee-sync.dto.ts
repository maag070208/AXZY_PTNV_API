import { z, registry } from "@core/swagger/registry";

/**
 * DTOs de la sincronización de empleados desde el Excel de nómina.
 *
 * El body de confirmación se valida a propósito de forma "permisiva" (sin
 * mínimos): el servicio revisa renglón por renglón y devuelve 422
 * `USER_SYNC_INVALID_ROWS` con el detalle de cada fila, que es lo que la
 * pantalla muestra junto al renglón del Excel. Un 400 de Zod solo quedaría para
 * un body que ni siquiera tiene la forma esperada.
 */

/** Un alta revisada por RH (nombre del Excel, departamento y credenciales editables). */
export const EmployeeSyncAltaDto = z
  .object({
    /** Renglón del Excel al que corresponde (para señalar el error en pantalla). */
    row: z.number().int().optional(),
    employeeNumber: z.string(),
    name: z.string(),
    departmentId: z.string(),
    jobTitle: z.string().optional(),
    username: z.string(),
    password: z.string(),
    scheduleId: z.string().optional(),
  })
  .openapi("EmployeeSyncAltaInput");

export type EmployeeSyncAltaInput = z.infer<typeof EmployeeSyncAltaDto>;

/** Una baja revisada por RH. */
export const EmployeeSyncBajaDto = z
  .object({ userId: z.string() })
  .openapi("EmployeeSyncBajaInput");

export type EmployeeSyncBajaInput = z.infer<typeof EmployeeSyncBajaDto>;

/** Cambio informativo y opcional sobre una persona que ya existe (nombre y/o departamento). */
export const EmployeeSyncCambioDto = z
  .object({
    userId: z.string(),
    name: z.string().optional(),
    departmentId: z.string().optional(),
  })
  .openapi("EmployeeSyncCambioInput");

export type EmployeeSyncCambioInput = z.infer<typeof EmployeeSyncCambioDto>;

/** Body de `POST /users/sync/confirm`. */
export const EmployeeSyncConfirmDto = z
  .object({
    altas: z.array(EmployeeSyncAltaDto).default([]),
    bajas: z.array(EmployeeSyncBajaDto).default([]),
    cambios: z.array(EmployeeSyncCambioDto).default([]),
  })
  .openapi("EmployeeSyncConfirmInput");

export type EmployeeSyncConfirmInput = z.infer<typeof EmployeeSyncConfirmDto>;

/** Un renglón del reporte exportado (lo que RH revisó, en el idioma del Excel). */
export const EmployeeSyncExportRowDto = z.object({
  employeeNumber: z.string().optional(),
  name: z.string().optional(),
  department: z.string().optional(),
  system: z.string().optional(),
  clock: z.string().optional(),
});

export type EmployeeSyncExportRowInput = z.infer<typeof EmployeeSyncExportRowDto>;

/** Body de `POST /users/sync/export`. */
export const EmployeeSyncExportDto = z
  .object({ rows: z.array(EmployeeSyncExportRowDto).default([]) })
  .openapi("EmployeeSyncExportInput");

export type EmployeeSyncExportInput = z.infer<typeof EmployeeSyncExportDto>;

registry.register("EmployeeSyncAltaInput", EmployeeSyncAltaDto);
registry.register("EmployeeSyncBajaInput", EmployeeSyncBajaDto);
registry.register("EmployeeSyncCambioInput", EmployeeSyncCambioDto);
registry.register("EmployeeSyncConfirmInput", EmployeeSyncConfirmDto);
registry.register("EmployeeSyncExportInput", EmployeeSyncExportDto);
