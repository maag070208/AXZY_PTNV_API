import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./ticket.service";

const createSchema = z.object({
  titulo: z.string().min(3).max(150),
  descripcion: z.string().min(3),
  priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
  category: z.enum(["MANTENIMIENTO", "EQUIPO", "SISTEMA", "OTRO"]).optional(),
  departmentId: z.string().optional(),
  asignadoAId: z.string().optional(),
});

const updateSchema = z.object({
  status: z.enum(["ABIERTO", "EN_SEGUIMIENTO", "CERRADO"]).optional(),
  priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
  asignadoAId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

const commentSchema = z.object({
  texto: z.string().min(1),
});

export const list = async (req: Request, res: Response) => {
  const search = typeof req.query.q === "string" ? req.query.q : undefined;
  const data = await service.listTickets(req.user!.id, req.user!.role, search, req.user!.departmentId);
  res.json({ data, total: data.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listTicketsTable(params, req.user!.id, req.user!.role, req.user!.departmentId);
  res.json({ data, total });
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getTicketById(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createTicket({
    ...input,
    creadoPorId: req.user!.id,
  });
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const raw = updateSchema.parse(req.body);
  const input = {
    ...raw,
    asignadoAId: raw.asignadoAId ?? undefined,
    departmentId: raw.departmentId ?? undefined,
  };
  const data = await service.updateTicket(req.params.id, input, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.json(data);
};

export const addComment = async (req: Request, res: Response) => {
  const input = commentSchema.parse(req.body);
  const data = await service.addComment(req.params.id, req.user!.id, input.texto);
  res.status(201).json(data);
};

export const remove = async (req: Request, res: Response) => {
  await service.deleteTicket(req.params.id, req.user?.id, req.user?.role, req.user?.departmentId ?? undefined);
  res.status(204).send();
};
