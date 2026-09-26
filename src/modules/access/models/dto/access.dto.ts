import { z, registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const AccessEventTypeSchema = z.enum(["ENTRY", "EXIT"]);
export const AccessMethodSchema = z.enum(["QR_SCAN", "MANUAL"]);
export const AccessLocationSourceSchema = z.enum(["GPS", "SITE_ONLY", "MANUAL"]);

/** POST /access/lookup — resuelve un QR crudo sin registrar. */
export const AccessLookupDto = registry.register(
  "AccessLookupInput",
  z.object({
    qr: z.string().min(1, "El código QR es obligatorio"),
  })
);

/** POST /access/events — alta del evento de acceso. */
export const AccessEventCreateSchema = registry.register(
  "AccessEventCreateInput",
  z.object({
    qr: z.string().min(1).optional(),
    employeeId: z.string().min(1).optional(),
    type: AccessEventTypeSchema,
    siteId: z.string().min(1, "El sitio es obligatorio"),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    accuracy: z.number().nonnegative().nullish(),
    deviceTimestamp: z.string().nullish(),
    clientEventId: z.string().min(1, "clientEventId es obligatorio"),
    deviceId: z.string().nullish(),
    deviceCode: z.string().nullish(),
    notes: z.string().max(500).nullish(),
  })
);

/** POST /access/:id/void — anulación lógica. */
export const AccessEventVoidDto = registry.register(
  "AccessEventVoidInput",
  z.object({
    reason: z.string().min(1, "El motivo es obligatorio").max(500),
  })
);

export const SiteSchema = registry.register(
  "Site",
  z.object({
    id: z.string(),
    name: z.string(),
    code: z.string().nullable(),
    active: z.boolean(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    radiusMeters: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
);

export const SiteCreateDto = registry.register(
  "SiteCreateInput",
  z.object({
    name: z.string().min(1, "El nombre es obligatorio").max(120),
    code: z.string().max(40).nullish(),
    active: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    radiusMeters: z.number().int().nonnegative().nullish(),
  })
);

export const SiteUpdateDto = registry.register(
  "SiteUpdateInput",
  z.object({
    name: z.string().min(1).max(120).optional(),
    code: z.string().max(40).nullish(),
    active: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    radiusMeters: z.number().int().nonnegative().nullish(),
  })
);

export const AccessEventSchema = registry.register(
  "AccessEvent",
  z.object({
    id: z.string(),
    type: AccessEventTypeSchema,
    occurredAt: z.string(),
    deviceTimestamp: z.string().nullable(),
    employeeId: z.string(),
    employeeNameSnapshot: z.string().nullable(),
    employeeNumberSnapshot: z.string().nullable(),
    guardId: z.string().nullable(),
    siteId: z.string().nullable(),
    site: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .optional(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    gpsAccuracyMeters: z.number().nullable(),
    locationSource: AccessLocationSourceSchema,
    method: AccessMethodSchema,
    credentialVersion: z.number().nullable(),
    scannedPayloadHash: z.string().nullable(),
    clientEventId: z.string().nullable(),
    deviceId: z.string().nullable(),
    deviceCode: z.string().nullable(),
    notes: z.string().nullable(),
    voidedAt: z.string().nullable(),
    voidedById: z.string().nullable(),
    voidReason: z.string().nullable(),
    createdAt: z.string(),
  })
);

export const AccessLookupResultSchema = registry.register(
  "AccessLookupResult",
  z.object({
    id: z.string(),
    name: z.string(),
    employeeNumber: z.string().nullable(),
    jobTitle: z.string().nullable(),
    department: z.string().nullable(),
    active: z.boolean(),
    // Ruta relativa a la base de la API (p. ej. `/personal/{id}/foto/raw`),
    // sin host ni prefijo `/api/v1`. El cliente la resuelve contra su base.
    photoUrl: z.string().nullable(),
    credentialVersion: z.number(),
    lastEvent: z
      .object({
        id: z.string(),
        type: AccessEventTypeSchema,
        occurredAt: z.string(),
        voidedAt: z.string().nullable(),
      })
      .nullable(),
    suggestedType: AccessEventTypeSchema,
  })
);

export const AccessStatusSchema = registry.register(
  "AccessStatus",
  z.object({
    employee: z.object({
      id: z.string(),
      name: z.string(),
      employeeNumber: z.string().nullable(),
      active: z.boolean(),
    }),
    lastEvent: z
      .object({
        id: z.string(),
        type: AccessEventTypeSchema,
        occurredAt: z.string(),
        voidedAt: z.string().nullable(),
        siteId: z.string().nullable(),
      })
      .nullable(),
    suggestedType: AccessEventTypeSchema,
    hasOpenEntry: z.boolean(),
  })
);

export const AccessTodayResponseSchema = registry.register(
  "AccessTodayResponse",
  z.object({
    data: z.array(AccessEventSchema),
    total: z.number(),
  })
);

export const AccessTableResponseSchema = paginatedTableResponseSchema(
  AccessEventSchema,
  "AccessTableResponse"
);

export const AccessQueryListSchema = TableQuerySchema;
