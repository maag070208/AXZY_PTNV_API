import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./department.service";

const createDeptSchema = z.object({
  name: z.string().min(2).max(80),
});

const updateDeptSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  active: z.boolean().optional(),
});

const createSubareaSchema = z.object({
  name: z.string().min(1).max(80),
});

export const list = async (req: Request, res: Response) => {
  const include = req.query.includeInactive === "true";
  const data = await service.listDepartments(include);
  res.json(data);
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listDepartmentsTable(params);
  res.json({ data, total });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getDepartment(req.params.id);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createDeptSchema.parse(req.body);
  const data = await service.createDepartment(input);
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateDeptSchema.parse(req.body);
  const data = await service.updateDepartment(req.params.id, input);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  const data = await service.deleteDepartment(req.params.id);
  res.json(data);
};

export const addSubarea = async (req: Request, res: Response) => {
  const input = createSubareaSchema.parse(req.body);
  const data = await service.createSubarea(req.params.id, input);
  res.status(201).json(data);
};

export const removeSubarea = async (req: Request, res: Response) => {
  const data = await service.deleteSubarea(req.params.id);
  res.json(data);
};