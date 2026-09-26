import { Request, Response } from "express";
import { Role } from "@prisma/client";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { parseFirstSheet, pickColumn } from "@core/utils/xlsxParse";
import {
  UserCreateDto,
  UserUpdateDto,
  UserPasswordDto,
  DeactivateUserDto,
  type UserCreateInput,
} from "../models/dto/user.dto";
import { UserService } from "../services/user.service";
import { UserHistoryService } from "../services/user-history.service";
import { UserImportService } from "../services/user-import.service";

const VALID_ROLES: readonly string[] = Object.values(Role);

export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly historyService: UserHistoryService,
    private readonly importService: UserImportService
  ) {}

  list = async (req: Request, res: Response) => {
    const rawRole = typeof req.query.role === "string" ? req.query.role : undefined;
    const role = rawRole && VALID_ROLES.includes(rawRole) ? (rawRole as UserCreateInput["role"]) : undefined;
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

  listEmployees = async (req: Request, res: Response) => {
    const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;
    const rolesParam = typeof req.query.roles === "string" ? req.query.roles : undefined;
    const rolesFilter = rolesParam
      ? rolesParam
          .split(",")
          .map((r) => r.trim())
          .filter((r): r is string => VALID_ROLES.includes(r))
      : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : undefined;

    const data = await this.users.list();
    const filtered = data.filter((u) => {
      if (!u.active) return false;
      if (departmentId && u.departmentId !== departmentId) return false;
      if (rolesFilter && !rolesFilter.includes(u.role)) return false;
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
    res.status(201).json(data);
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

  importUsers = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "EXCEL_FILE_REQUIRED");

    const rawRows = parseFirstSheet(req.file.buffer);
    const rows = rawRows.map((r) => ({
      name: pickColumn(r, ["NOMBRE DEL EMPLEADO", "NOMBRE"]),
      username: pickColumn(r, ["NOMBRE DE USUARIO", "USUARIO", "USERNAME"]),
      password: pickColumn(r, ["CONTRASEÑA", "CONTRASENA", "PASSWORD"]),
    }));

    const data = await this.importService.import(rows);
    res.status(201).json(data);
  };
}