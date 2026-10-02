import { Router } from "express";
import { authenticate, requiresPermission } from "@core/middlewares/auth.middleware";
import { asyncHandler } from "@core/utils/asyncHandler";
import { registerPath } from "@core/swagger/registry";
import {
  PermissionCatalogCreateSchema,
  PermissionCatalogListSchema,
  PermissionCatalogSchema,
  PermissionCatalogUpdateSchema,
  PermissionMatrixUpdateSchema,
  RoleCreateSchema,
  RoleListSchema,
  RoleSchema,
  RoleUpdateSchema,
  RolesAdminResponseSchema,
} from "../models/dto/permission.dto";
import {
  PolicyCreateSchema,
  PolicyListSchema,
  PolicySchema,
  PolicyUpdateSchema,
} from "../models/dto/policy.dto";
import {
  AccessActivityPageSchema,
  AccessMemberListSchema,
  AccessMemberSchema,
  SimulationInputSchema,
  SimulationSchema,
  UserAccessSchema,
} from "../models/dto/access.dto";
import type { PermissionController } from "../controllers/permission.controller";

const bearer = [{ bearerAuth: [] }];

export const createPermissionsRoutes = (controller: PermissionController): Router => {
  const router = Router();

  registerPath({
    method: "get",
    path: "/permissions/catalog",
    tags: ["Permissions"],
    summary: "Catalog of active permissions",
    security: bearer,
    responses: {
      200: {
        description: "Active permissions",
        content: {
          "application/json": { schema: PermissionCatalogListSchema },
        },
      },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/admin",
    tags: ["Permissions"],
    summary: "Roles, full catalog and matrix (roles.manage)",
    security: bearer,
    responses: {
      200: {
        description: "Administration data",
        content: { "application/json": { schema: RolesAdminResponseSchema } },
      },
    },
  });

  registerPath({
    method: "put",
    path: "/permissions/matrix",
    tags: ["Permissions"],
    summary: "Update cells of the role → permission → scope matrix (roles.manage)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionMatrixUpdateSchema } } },
    },
    responses: {
      200: { description: "Matrix updated", content: { "application/json": { schema: { type: "object" } } } },
      400: { description: "Invalid changes" },
      409: { description: "Conflict (ADMIN lockout)" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/catalog",
    tags: ["Permissions"],
    summary: "Create catalog permission (roles.manage)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogCreateSchema } } },
    },
    responses: {
      201: { description: "Permission created", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Invalid body" },
      409: { description: "Duplicate key" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permissions/catalog/{key}",
    tags: ["Permissions"],
    summary: "Update catalog permission (roles.manage)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
    ],
    request: {
      body: { required: true, content: { "application/json": { schema: PermissionCatalogUpdateSchema } } },
    },
    responses: {
      200: { description: "Permission updated", content: { "application/json": { schema: PermissionCatalogSchema } } },
      400: { description: "Invalid body" },
      404: { description: "Permission not found" },
      409: { description: "Scopes with active grants" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/reload",
    tags: ["Permissions"],
    summary: "Reload catalog and matrix from the DB (roles.manage)",
    security: bearer,
    responses: {
      200: { description: "Caches recargadas", content: { "application/json": { schema: { type: "object" } } } },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/roles",
    tags: ["Permissions"],
    summary: "List system roles with their assigned user count",
    security: bearer,
    responses: {
      200: { description: "Roles", content: { "application/json": { schema: RoleListSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/roles",
    tags: ["Permissions"],
    summary: "Create role (roles.manage)",
    security: bearer,
    request: {
      body: { required: true, content: { "application/json": { schema: RoleCreateSchema } } },
    },
    responses: {
      201: { description: "Role created", content: { "application/json": { schema: RoleSchema } } },
      400: { description: "Invalid body" },
      409: { description: "Duplicate key" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permissions/roles/{key}",
    tags: ["Permissions"],
    summary: "Update role (roles.manage)",
    security: bearer,
    parameters: [{ in: "path", name: "key", required: true, schema: { type: "string" } }],
    request: {
      body: { required: true, content: { "application/json": { schema: RoleUpdateSchema } } },
    },
    responses: {
      200: { description: "Role updated", content: { "application/json": { schema: RoleSchema } } },
      400: { description: "Invalid body" },
      404: { description: "Role not found" },
      409: { description: "System role protected or lockout" },
    },
  });

  registerPath({
    method: "delete",
    path: "/permissions/roles/{key}",
    tags: ["Permissions"],
    summary: "Delete role (roles.manage)",
    security: bearer,
    parameters: [{ in: "path", name: "key", required: true, schema: { type: "string" } }],
    responses: {
      204: { description: "Role deleted" },
      404: { description: "Role not found" },
      409: { description: "System role or role with users" },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/policies",
    tags: ["Permissions"],
    summary: "List dynamic ABAC policies and the action catalog (roles.manage)",
    security: bearer,
    responses: {
      200: { description: "Policies and actions", content: { "application/json": { schema: PolicyListSchema } } },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/policies",
    tags: ["Permissions"],
    summary: "Create a policy (roles.manage)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: PolicyCreateSchema } } } },
    responses: {
      201: { description: "Policy created", content: { "application/json": { schema: PolicySchema } } },
      400: { description: "Invalid body" },
    },
  });

  registerPath({
    method: "patch",
    path: "/permissions/policies/{id}",
    tags: ["Permissions"],
    summary: "Update a policy (roles.manage)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    request: { body: { required: true, content: { "application/json": { schema: PolicyUpdateSchema } } } },
    responses: {
      200: { description: "Policy updated", content: { "application/json": { schema: PolicySchema } } },
      404: { description: "Policy not found" },
    },
  });

  registerPath({
    method: "delete",
    path: "/permissions/policies/{id}",
    tags: ["Permissions"],
    summary: "Delete a policy (roles.manage)",
    security: bearer,
    parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
    responses: {
      204: { description: "Policy deleted" },
      404: { description: "Policy not found" },
      409: { description: "Base policy protected" },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/members",
    tags: ["Permissions"],
    summary: "People with their primary role, additional roles and current exceptions (roles.manage)",
    security: bearer,
    responses: {
      200: { description: "People", content: { "application/json": { schema: AccessMemberListSchema } } },
    },
  });

  registerPath({
    method: "get",
    path: "/permissions/members/{userId}/access",
    tags: ["Permissions"],
    summary: "Effective access of a person, permission by permission, with its source (roles.manage)",
    security: bearer,
    parameters: [{ in: "path", name: "userId", required: true, schema: { type: "string" } }],
    responses: {
      200: { description: "Effective access", content: { "application/json": { schema: UserAccessSchema } } },
      404: { description: "User not found" },
    },
  });

  registerPath({
    method: "put",
    path: "/permissions/roles/{key}/members/{userId}",
    tags: ["Permissions"],
    summary: "Add the role to a person as an additional role (roles.manage)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
      { in: "path", name: "userId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Person updated", content: { "application/json": { schema: AccessMemberSchema } } },
      404: { description: "Role or user not found" },
      409: { description: "Already assigned or inactive role" },
    },
  });

  registerPath({
    method: "delete",
    path: "/permissions/roles/{key}/members/{userId}",
    tags: ["Permissions"],
    summary: "Remove an additional role from a person (roles.manage)",
    security: bearer,
    parameters: [
      { in: "path", name: "key", required: true, schema: { type: "string" } },
      { in: "path", name: "userId", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Person updated", content: { "application/json": { schema: AccessMemberSchema } } },
      404: { description: "User not found or role not assigned" },
      409: { description: "It is the primary role" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/simulate",
    tags: ["Permissions"],
    summary: "Access tester: identity → RBAC → ABAC for a person and an action (roles.manage)",
    security: bearer,
    request: { body: { required: true, content: { "application/json": { schema: SimulationInputSchema } } } },
    responses: {
      200: { description: "Decision with its trace", content: { "application/json": { schema: SimulationSchema } } },
      400: { description: "Invalid body, permission or resource field" },
      404: { description: "User not found" },
    },
  });

  registerPath({
    method: "post",
    path: "/permissions/activity/query",
    tags: ["Permissions"],
    summary: "Access-control activity log: role/permission/policy changes and denied accesses (roles.manage)",
    security: bearer,
    responses: {
      200: { description: "Page of activity", content: { "application/json": { schema: AccessActivityPageSchema } } },
      400: { description: "Invalid filter" },
    },
  });

  router.use(authenticate);

  // Roles y catálogo activo: solo requieren sesión, la web los usa para mostrar
  // nombres y armar los selectores.
  router.get("/roles", asyncHandler(controller.roles));
  router.get("/catalog", asyncHandler(controller.catalog));

  router.post("/roles", requiresPermission("roles.manage"), asyncHandler(controller.createRole));
  router.patch("/roles/:key", requiresPermission("roles.manage"), asyncHandler(controller.updateRole));
  router.delete("/roles/:key", requiresPermission("roles.manage"), asyncHandler(controller.deleteRole));

  router.get("/policies", requiresPermission("roles.manage"), asyncHandler(controller.policies));
  router.post("/policies", requiresPermission("roles.manage"), asyncHandler(controller.createPolicy));
  router.patch("/policies/:id", requiresPermission("roles.manage"), asyncHandler(controller.updatePolicy));
  router.delete("/policies/:id", requiresPermission("roles.manage"), asyncHandler(controller.deletePolicy));

  router.get("/members", requiresPermission("roles.manage"), asyncHandler(controller.members));
  router.get("/members/:userId/access", requiresPermission("roles.manage"), asyncHandler(controller.memberAccess));
  router.put("/roles/:key/members/:userId", requiresPermission("roles.manage"), asyncHandler(controller.addRoleMember));
  router.delete("/roles/:key/members/:userId", requiresPermission("roles.manage"), asyncHandler(controller.removeRoleMember));
  router.post("/simulate", requiresPermission("roles.manage"), asyncHandler(controller.simulate));
  router.post("/activity/query", requiresPermission("roles.manage"), asyncHandler(controller.activity));

  router.get("/admin", requiresPermission("roles.manage"), asyncHandler(controller.admin));
  router.put("/matrix", requiresPermission("roles.manage"), asyncHandler(controller.matrix));
  router.post("/catalog", requiresPermission("roles.manage"), asyncHandler(controller.create));
  router.patch(
    "/catalog/:key",
    requiresPermission("roles.manage"),
    asyncHandler(controller.update)
  );
  router.post("/reload", requiresPermission("roles.manage"), asyncHandler(controller.reload));

  return router;
};
