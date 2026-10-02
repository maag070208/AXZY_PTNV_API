import type { Policy, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { POLICY_ACTIONS, loadPoliciesFromDb, type PolicyActionDef } from "@core/policies";
import type { AuditLogger } from "@modules/users/services/user.service";
import {
  parseConditions,
  type PolicyCreateInput,
  type PolicyUpdateInput,
} from "../models/dto/policy.dto";

type PolicyWithRelations = Policy & {
  conditions: Array<{ field: string; operator: string; value: string | null }>;
  roles: Array<{ role: string }>;
};

export interface PolicyAdmin {
  id: string;
  /** Clave de las políticas base (null en las creadas a mano). */
  key: string | null;
  name: string;
  description: string | null;
  action: string;
  effect: "ALLOW" | "DENY";
  priority: number;
  active: boolean;
  roles: string[];
  conditions: Array<{ field: string; operator: string; value: string | null }>;
  createdAt: string;
}

const include = {
  conditions: { select: { field: true, operator: true, value: true } },
  roles: { select: { role: true } },
} as const;

const toAdmin = (row: PolicyWithRelations): PolicyAdmin => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description ?? null,
  action: row.action,
  effect: row.effect,
  priority: row.priority,
  active: row.active,
  roles: row.roles.map((r) => r.role),
  conditions: row.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
  createdAt: row.createdAt.toISOString(),
});

const conditionData = (conditions: Array<{ field: string; operator: string; value?: string | null }>) =>
  conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value ?? null }));

/**
 * Administración de las políticas ABAC dinámicas. Tras cada escritura recarga la
 * cache del motor (`@core/policies`) para que apliquen al instante.
 */
export class PolicyService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Políticas + catálogo de acciones disponibles (campos por acción). */
  async list(): Promise<{ policies: PolicyAdmin[]; actions: readonly PolicyActionDef[] }> {
    const rows = await this.db.policy.findMany({
      include,
      orderBy: [{ action: "asc" }, { priority: "asc" }],
    });
    return { policies: rows.map(toAdmin), actions: POLICY_ACTIONS };
  }

  async create(dto: PolicyCreateInput, actorId: string): Promise<PolicyAdmin> {
    const created = await this.db.policy.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        action: dto.action,
        effect: dto.effect,
        priority: dto.priority ?? 100,
        active: dto.active ?? true,
        createdById: actorId,
        conditions: { create: conditionData(dto.conditions) },
        roles: { create: dto.roles.map((role) => ({ role })) },
      },
      include,
    });
    await this.audit?.({
      action: "POLICY_CREATED",
      entityType: "Policy",
      entityId: created.id,
      userId: actorId,
      newState: { action: created.action, effect: created.effect, active: created.active },
    });
    await loadPoliciesFromDb(this.db);
    return toAdmin(created);
  }

  async update(id: string, dto: PolicyUpdateInput, actorId: string): Promise<PolicyAdmin> {
    const previous = await this.db.policy.findUnique({ where: { id } });
    if (!previous) throw new HttpError(404, "POLICY_NOT_FOUND", { id });

    const effectiveAction = dto.action ?? previous.action;
    const conditions =
      dto.conditionsRaw === undefined
        ? undefined
        : parseConditions(dto.conditionsRaw, effectiveAction);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.action !== undefined) data.action = dto.action;
    if (dto.effect !== undefined) data.effect = dto.effect;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.active !== undefined) data.active = dto.active;

    await this.db.$transaction(async (tx) => {
      await tx.policy.update({ where: { id }, data });
      if (dto.roles !== undefined) {
        await tx.policyRole.deleteMany({ where: { policyId: id } });
        if (dto.roles.length > 0) {
          await tx.policyRole.createMany({ data: dto.roles.map((role) => ({ policyId: id, role })) });
        }
      }
      if (conditions !== undefined) {
        await tx.policyCondition.deleteMany({ where: { policyId: id } });
        if (conditions.length > 0) {
          await tx.policyCondition.createMany({
            data: conditions.map((c) => ({ policyId: id, field: c.field, operator: c.operator, value: c.value ?? null })),
          });
        }
      }
    });

    await this.audit?.({
      action: "POLICY_UPDATED",
      entityType: "Policy",
      entityId: id,
      userId: actorId,
      previousState: { action: previous.action, effect: previous.effect, active: previous.active },
    });
    await loadPoliciesFromDb(this.db);
    const updated = await this.db.policy.findUniqueOrThrow({ where: { id }, include });
    return toAdmin(updated);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const policy = await this.db.policy.findUnique({ where: { id } });
    if (!policy) throw new HttpError(404, "POLICY_NOT_FOUND", { id });
    if (policy.key) {
      throw new HttpError(409, "POLICY_SYSTEM_PROTECTED", { key: policy.key });
    }
    await this.db.policy.delete({ where: { id } });
    await this.audit?.({
      action: "POLICY_DELETED",
      entityType: "Policy",
      entityId: id,
      userId: actorId,
      previousState: { action: policy.action, effect: policy.effect },
    });
    await loadPoliciesFromDb(this.db);
  }

  /** Recarga la cache de políticas desde la BD (multi-instancia). */
  async reload(): Promise<void> {
    await loadPoliciesFromDb(this.db);
  }
}
