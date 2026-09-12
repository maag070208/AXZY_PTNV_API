import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { CartaService } from "../services/carta.service";
import { CartaConsecutivoService } from "../services/carta-consecutivo.service";
import {
  CartaCreateInputSchema,
  CartaGenerateInputSchema,
  CartaReturnInputSchema,
  CartaUpdateInputSchema,
} from "../models/dto/carta.dto";

export class CartaController {
  constructor(
    private readonly cartaService: CartaService,
    private readonly consecutivoService: CartaConsecutivoService
  ) {}

  private scope(req: Request) {
    return {
      userId: req.user?.id,
      role: req.user?.role,
      departmentId: req.user?.departmentId,
    };
  }

  list = async (req: Request, res: Response) => {
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    const data = await this.cartaService.list(search, this.scope(req));
    res.json({ data, total: data.length });
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.cartaService.table(params, this.scope(req));
    res.json(paginatedTable(params, data, total));
  };

  peek = async (_req: Request, res: Response) => {
    const next = await this.consecutivoService.peek();
    res.json({ siguiente: next });
  };

  generateCartas = async (req: Request, res: Response) => {
    const { typeId } = CartaGenerateInputSchema.parse(req.body);
    const data = await this.cartaService.generateByType(typeId, req.user?.id);
    res.status(201).json(data);
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.cartaService.getById(req.params.id, this.scope(req));
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    if (req.user?.role === "JEFE_DE_AREA") {
      res.status(403).json({ message: "Los jefes de área no pueden crear cartas responsivas" });
      return;
    }
    const input = CartaCreateInputSchema.parse(req.body);
    const data = await this.cartaService.create({
      ...input,
      creadoPorId: req.user?.id,
    });
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const input = CartaUpdateInputSchema.parse(req.body);
    const data = await this.cartaService.update(req.params.id, input, this.scope(req));
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    await this.cartaService.remove(req.params.id, this.scope(req));
    res.status(204).send();
  };

  resetConsecutivoCtrl = async (_req: Request, res: Response) => {
    const data = await this.consecutivoService.reset();
    res.json(data);
  };

  getConsecutivo = async (_req: Request, res: Response) => {
    const data = await this.consecutivoService.state();
    res.json({
      prefijo: data.prefijo,
      contador: data.contador,
      siguiente: `${data.prefijo}${String(data.contador + 1).padStart(4, "0")}`,
    });
  };

  returnCarta = async (req: Request, res: Response) => {
    const input = CartaReturnInputSchema.parse(req.body);
    const data = await this.cartaService.returnCarta(req.params.id, input, this.scope(req));
    res.json(data);
  };

  undoReturn = async (req: Request, res: Response) => {
    const data = await this.cartaService.undoReturn(req.params.id, this.scope(req));
    res.json(data);
  };
}