import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./user.service";

const createSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["ADMIN", "GERENTE", "JEFE_DE_AREA", "EMPLEADO"]).optional(),
  puesto: z.string().optional(),
  numeroEmpleado: z.string().optional(),
  departmentId: z.string().optional(),
  subareaId: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().optional(),
  role: z.enum(["ADMIN", "GERENTE", "JEFE_DE_AREA", "EMPLEADO"]).optional(),
  active: z.boolean().optional(),
  puesto: z.string().optional(),
  numeroEmpleado: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  subareaId: z.string().nullable().optional(),
});

const passwordSchema = z.object({
  password: z.string().min(6),
});

export const list = async (req: Request, res: Response) => {
  const role = typeof req.query.role === "string" ? (req.query.role as any) : undefined;
  const data = await service.listUsers(role);
  res.json(data);
};

export const getById = async (req: Request, res: Response) => {
  const data = await service.getUserById(req.params.id);
  res.json(data);
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listUsersTable(params, req.user?.role);
  res.json({ data, total });
};

export const listEmpleados = async (req: Request, res: Response) => {
  const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : undefined;
  const data = await service.listUsers("EMPLEADO");
  const filtered = data.filter((u) => {
    if (!u.active) return false;
    if (departmentId && u.departmentId !== departmentId) return false;
    return true;
  });
  res.json(filtered);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createUser(input);
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateUser(req.params.id, input);
  res.json(data);
};

export const changePassword = async (req: Request, res: Response) => {
  const { password } = passwordSchema.parse(req.body);
  await service.changePassword(req.params.id, password);
  res.status(204).send();
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteUser(req.params.id);
  res.json(data);
};

export const history = async (req: Request, res: Response) => {
  const data = await service.getUserHistory(req.params.id);
  res.json(data);
};