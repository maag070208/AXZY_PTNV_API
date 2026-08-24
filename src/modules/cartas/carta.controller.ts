import { Request, Response } from "express";
import { z } from "zod";
import { parseTableParams } from "@core/utils/table";
import * as service from "./carta.service";

const itemSchema = z.object({
  deviceId: z.string().optional(),
  descripcion: z.string().min(1),
  marca: z.string().min(1),
  modelo: z.string().min(1),
  numeroSerie: z.string().optional(),
  nombreEquipo: z.string().optional(),
  controlActivos: z.string().min(1),
  area: z.string().optional(),
});

const createSchema = z.object({
  consecutivo: z.string().optional(),
  fecha: z.string().optional(),
  numeroEmpleado: z.string().min(1),
  empresa: z.string().optional(),
  departamento: z.string().optional(),
  areaBoss: z.string().optional(),
  deliveryBy: z.string().optional(),
  responsableId: z.string().optional(),
  encargadoId: z.string().optional(),
  item: itemSchema,
});

const returnSchema = z.object({
  returnedBy: z.string().min(1, "Nombre requerido"),
  returnCondition: z.string().min(1, "Condiciones requeridas"),
});

const generateSchema = z.object({
  typeId: z.string().min(1, "Tipo requerido"),
});

const updateSchema = createSchema.partial();

export const list = async (req: Request, res: Response) => {
  const search = typeof req.query.q === "string" ? req.query.q : undefined;
  const data = await service.listCartas(search, req.user?.id, req.user?.role);
  res.json({ data, total: data.length });
};

export const table = async (req: Request, res: Response) => {
  const params = parseTableParams(req.body);
  const { data, total } = await service.listCartasTable(
    params,
    req.user?.id,
    req.user?.role
  );
  res.json({ data, total });
};

export const peek = async (_req: Request, res: Response) => {
  const next = await service.peekConsecutivo();
  res.json({ siguiente: next });
};

export const generateCartas = async (req: Request, res: Response) => {
  const { typeId } = generateSchema.parse(req.body);
  const data = await service.generateCartasByType(
    typeId,
    req.user?.id
  );
  res.status(201).json(data);
};

export const getOne = async (req: Request, res: Response) => {
  const data = await service.getCartaById(req.params.id, req.user?.id, req.user?.role);
  res.json(data);
};

export const create = async (req: Request, res: Response) => {
  const input = createSchema.parse(req.body);
  const data = await service.createCarta({
    ...input,
    creadoPorId: req.user?.id,
  });
  res.status(201).json(data);
};

export const update = async (req: Request, res: Response) => {
  const input = updateSchema.parse(req.body);
  const data = await service.updateCarta(req.params.id, input, req.user?.id, req.user?.role);
  res.json(data);
};

export const remove = async (req: Request, res: Response) => {
  await service.deleteCarta(req.params.id, req.user?.id, req.user?.role);
  res.status(204).send();
};

export const resetConsecutivoCtrl = async (_req: Request, res: Response) => {
  const data = await service.resetConsecutivo();
  res.json(data);
};

export const getConsecutivo = async (_req: Request, res: Response) => {
  const data = await service.getConsecutivoState();
  res.json({
    prefijo: data.prefijo,
    contador: data.contador,
    siguiente: `${data.prefijo}${String(data.contador + 1).padStart(4, "0")}`,
  });
};

export const returnCarta = async (req: Request, res: Response) => {
  const input = returnSchema.parse(req.body);
  const data = await service.returnCarta(
    req.params.id,
    input,
    req.user?.id,
    req.user?.role
  );
  res.json(data);
};

export const undoReturn = async (req: Request, res: Response) => {
  const data = await service.undoReturnCarta(
    req.params.id,
    req.user?.id,
    req.user?.role
  );
  res.json(data);
};