import { HttpError } from "@core/middlewares/error.middleware";
import { z, registry } from "@core/swagger/registry";
import type { SimulationInput } from "../entity/access.entity";
import { PermissionKey } from "./permission.dto";

const asRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY");
  }
  return body as Record<string, unknown>;
};

/** Body de `POST /permissions/simulate`. Los campos del registro los valida el servicio contra la acción. */
export const parseSimulationBody = (body: unknown): SimulationInput => {
  const b = asRecord(body);
  if (typeof b.userId !== "string" || !b.userId.trim()) {
    throw new HttpError(400, "FIELD_REQUIRED", { field: "userId" });
  }
  if (typeof b.permission !== "string" || !PermissionKey.test(b.permission)) {
    throw new HttpError(400, "INVALID_PERMISSION_KEY");
  }
  const resource = b.resource;
  if (resource !== undefined && resource !== null && (typeof resource !== "object" || Array.isArray(resource))) {
    throw new HttpError(400, "INVALID_BODY");
  }
  return {
    userId: b.userId,
    permission: b.permission,
    resource: (resource as Record<string, unknown> | null | undefined) ?? null,
  };
};

// --- Schemas de Swagger ---------------------------------------------------

const scopeSchema = z.enum(["NONE", "OWN", "AREA", "ALL"]);

export const AccessMemberSchema = registry.register(
  "AccessMember",
  z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    employeeNumber: z.string().nullable(),
    jobTitle: z.string().nullable(),
    department: z.string().nullable(),
    active: z.boolean(),
    role: z.string(),
    extraRoles: z.array(z.string()),
    exceptions: z.number().int(),
  })
);

export const AccessMemberListSchema = registry.register("AccessMemberList", z.array(AccessMemberSchema));

const exceptionSchema = z
  .object({ scope: scopeSchema, reason: z.string().nullable(), expiresAt: z.string().nullable() })
  .nullable();

export const UserAccessSchema = registry.register(
  "UserAccess",
  z.object({
    user: AccessMemberSchema,
    roles: z.array(z.object({ key: z.string(), primary: z.boolean(), active: z.boolean() })),
    permissions: z.array(
      z.object({
        key: z.string(),
        effective: scopeSchema,
        byRole: z.record(scopeSchema),
        exception: exceptionSchema,
      })
    ),
  })
);

export const SimulationInputSchema = registry.register(
  "AccessSimulationInput",
  z.object({
    userId: z.string(),
    permission: z.string(),
    resource: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
);

export const SimulationSchema = registry.register(
  "AccessSimulation",
  z.object({
    allowed: z.boolean(),
    identity: z.object({ ok: z.boolean(), active: z.boolean() }),
    rbac: z.object({
      ok: z.boolean(),
      permissionActive: z.boolean(),
      scope: scopeSchema,
      byRole: z.record(scopeSchema),
      exception: exceptionSchema,
    }),
    abac: z.object({
      evaluated: z.boolean(),
      ok: z.boolean(),
      hasRules: z.boolean(),
      supportsContext: z.boolean(),
      explanation: z.object({}).passthrough().nullable(),
    }),
  })
);

export const AccessActivityPageSchema = registry.register(
  "AccessActivityPage",
  z.object({
    total: z.number().int(),
    data: z.array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        action: z.string(),
        entityType: z.string(),
        entityId: z.string(),
        actor: z.object({ id: z.string().nullable(), name: z.string().nullable(), username: z.string().nullable() }),
        previousState: z.object({}).passthrough().nullable(),
        newState: z.object({}).passthrough().nullable(),
        metadata: z.object({}).passthrough().nullable(),
      })
    ),
  })
);
