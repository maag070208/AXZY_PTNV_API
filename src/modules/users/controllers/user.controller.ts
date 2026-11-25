import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { roleKeys } from "@core/permissions";
import { parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
import {
  UserAvailabilityQuery,
  UserCreateDto,
  UserUpdateDto,
  UserPasswordDto,
  DeactivateUserDto,
  SetUserPermissionExceptionDto,
  type UserCreateInput,
} from "../models/dto/user.dto";
import { UserService } from "../services/user.service";
import { UserHistoryService } from "../services/user-history.service";
import { UserImportService } from "../services/user-import.service";
import { logger } from "@core/utils/logger";
import { UserPermissionsService } from "../services/user-permissions.service";

const VALID_ROLES = (): string[] => roleKeys();

/** Gancho posterior a la alta (DIP): alta automática en relojes. Nunca debe lanzar. */
export type UserAfterCreate = (user: {
  id: string;
  role: string;
  employeeNumber?: string | null;
}, actorId: string) => Promise<{ results: unknown[] } | null>;

export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly historyService: UserHistoryService,
    private readonly importService: UserImportService,
    private readonly permissions: UserPermissionsService,
    private readonly afterCreate?: UserAfterCreate
  ) {}

  list = async (req: Request, res: Response) => {
    const rawRole = typeof req.query.role === "string" ? req.query.role : undefined;
    const validRoles = VALID_ROLES();
    const role = rawRole && validRoles.includes(rawRole) ? (rawRole as UserCreateInput["role"]) : undefined;
    const data = await this.users.list(role);
    res.json(data);
  };

  getById = async (req: Request, res: Response) => {
    const data = await this.users.getById(req.params.id);
    res.json(data);
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.users.table(params, req.user?.role, req.user?.departmentId);
    res.json(paginatedTable(params, data, total));
  };

  availability = async (req: Request, res: Response) => {
    const query = UserAvailabilityQuery.parse(req.body);
    res.json(await this.users.availability(query));
  };

  listEmployees = async (req: Request, res: Response) => {
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;
    const rolesParam = typeof req.query.roles === "string" ? req.query.roles : undefined;
    const rolesFilter = rolesParam
      ? rolesParam
          .split(",")
          .map((r) => r.trim())
          .filter((r): r is string => VALID_ROLES().includes(r))
      : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : undefined;
    // Opciones de filtros de tablas: también quien ya se dio de baja tiene registros.
    const includeInactive = req.query.includeInactive === "true";

    const data = await this.users.list();
    const filtered = data.filter((u) => {
      if (!u.active && !includeInactive) return false;
      if (departmentId && u.departmentId !== departmentId) return false;
      if (rolesFilter && !rolesFilter.includes(u.role)) {
        const extras = (u as { extraRoles?: Array<{ role: string }> }).extraRoles ?? [];
        if (!extras.some((extra) => rolesFilter.includes(extra.role))) return false;
      }
      if (q) {
        const haystack = [
          u.name,
          u.employeeNumber,
          u.jobTitle,
          u.department?.name,
          u.username,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    res.json(filtered);
  };

  create = async (req: Request, res: Response) => {
    const input = UserCreateDto.parse(req.body);
    const data = await this.users.create(input, req.user!.id);
    // Alta automática en relojes ya con el usuario confirmado; un fallo no afecta la creación.
    let clockSync: { results: unknown[] } | null = null;
    try {
      clockSync = (await this.afterCreate?.(data, req.user!.id)) ?? null;
    } catch {
      clockSync = null;
    }
    res.status(201).json(clockSync ? { ...data, clockSync } : data);
  };

  update = async (req: Request, res: Response) => {
    const input = UserUpdateDto.parse(req.body);
    const data = await this.users.update(req.params.id, input);
    res.json(data);
  };

  changePassword = async (req: Request, res: Response) => {
    const { password } = UserPasswordDto.parse(req.body);
    await this.users.changePassword(req.params.id, password);
    res.status(204).send();
  };

  remove = async (req: Request, res: Response) => {
    const force = req.query.force === "true" || req.body?.force === true;
    const data = await this.users.remove(req.params.id, req.user?.id, force);
    res.json(data);
  };

  deactivate = async (req: Request, res: Response) => {
    const input = DeactivateUserDto.parse(req.body);
    const data = await this.users.deactivate(req.params.id, req.user!.id, input);
    res.json(data);
  };

  reactivate = async (req: Request, res: Response) => {
    const data = await this.users.reactivate(req.params.id, req.user!.id);
    res.json(data);
  };

  history = async (req: Request, res: Response) => {
    const data = await this.historyService.getHistory(req.params.id);
    res.json(data);
  };

  listPermissions = async (req: Request, res: Response) => {
    res.json(await this.permissions.list(req.params.id));
  };

  setPermission = async (req: Request, res: Response) => {
    const dto = SetUserPermissionExceptionDto.parse(req.body);
    res.json(await this.permissions.set(req.params.id, req.params.permission, dto, req.user!));
  };

  removePermission = async (req: Request, res: Response) => {
    res.json(await this.permissions.remove(req.params.id, req.params.permission, req.user!.id));
  };

  importUsers = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "EXCEL_FILE_REQUIRED");

    // Encabezados del Excel del cliente (en español) o sus equivalentes en inglés.
    const rawRows = parseFirstSheet(req.file.buffer);
    const rows = rawRows.map((r) => ({
      name: pickColumn(r, ["NOMBRE DEL EMPLEADO", "NOMBRE", "EMPLOYEE NAME", "NAME"]),
      username: pickColumn(r, ["NOMBRE DE USUARIO", "USUARIO", "USERNAME"]),
      password: pickColumn(r, ["CONTRASEÑA", "CONTRASENA", "PASSWORD"]),
      employeeNumber: pickColumn(r, [
        "NÚMERO DE EMPLEADO",
        "NUMERO DE EMPLEADO",
        "NO. EMPLEADO",
        "NÚMERO",
        "NUMERO",
        "EMPLOYEE NUMBER",
      ]),
    }));

    const { createdUsers, ...data } = await this.importService.import(rows);
    // Alta en relojes en segundo plano: muchas filas × relojes excederían el timeout del proxy.
    const hook = this.afterCreate;
    const clockEnrollQueued = hook ? createdUsers.filter((u) => !!u.employeeNumber?.trim()).length : 0;
    if (hook && clockEnrollQueued > 0) {
      const actorId = req.user!.id;
      void this.enrollImportedInBackground(createdUsers, actorId, hook);
    }
    res.status(201).json({ ...data, clockEnrollQueued });
  };

  /** Uno por uno (secuencial); el hook nunca lanza, aun así se protege cada vuelta. */
  private async enrollImportedInBackground(
    users: { id: string; role: string; employeeNumber: string | null }[],
    actorId: string,
    hook: UserAfterCreate
  ): Promise<void> {
    for (const user of users) {
      if (!user.employeeNumber?.trim()) continue;
      try {
        const sync = (await hook(user, actorId)) as
          | { results: Array<{ serial?: string; ok?: boolean; code?: string }> }
          | null;
        const failed = sync?.results.filter((r) => !r.ok) ?? [];
        if (failed.length > 0) {
          logger.warn(
            `[user-import] alta en relojes con fallos (usuario ${user.id}): ${failed
              .map((f) => `${f.serial || "-"}:${f.code ?? "ERROR"}`)
              .join(", ")}`
          );
        }
      } catch (e) {
        logger.warn(`[user-import] alta en relojes falló (usuario ${user.id}): ${(e as Error).message}`);
      }
    }
  }
}