import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { ChecadorService } from "../services/checador.service";
import { ChecadorEmpleadosService } from "../services/checador-empleados.service";
import { ChecadorReportService } from "../services/checador-report.service";
import {
  ChecadorImportDto,
  ChecadorRelojDto,
  ChecadorRelojUpdateDto,
  ChecadorVinculoDto,
} from "../models/dto/checador.dto";

/**
 * Como en `/access/report`: el export pide `limit` 1000 y el schema compartido
 * de tablas descarta TODO el body si `limit` excede 100 (se perderían
 * `period/date`), así que se clampa antes de `parseTableParams`.
 */
const parseReportParams = (body: unknown) => {
  const raw = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  const limit = Number(raw.limit);
  if (raw.limit !== undefined && Number.isFinite(limit)) raw.limit = Math.min(limit, 100);
  return parseTableParams(raw);
};

export class ChecadorController {
  constructor(
    private readonly service: ChecadorService,
    private readonly report: ChecadorReportService,
    private readonly empleados: ChecadorEmpleadosService
  ) {}

  table = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.table(params);
    res.json(paginatedTable(params, data, total));
  };

  status = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.status());
  };

  /** 202: la importación sigue en segundo plano; su avance sale en `/status`. */
  importar = async (req: Request, res: Response): Promise<void> => {
    const input = ChecadorImportDto.parse(req.body);
    res.status(202).json(await this.service.importar(input));
  };

  /** 202: el drenado sigue en segundo plano; su avance sale en `/status`. */
  sync = async (_req: Request, res: Response): Promise<void> => {
    res.status(202).json(await this.service.sync());
  };

  /** 201: el reloj contestó y quedó dado de alta; su primera sincronización ya arrancó. */
  registrarReloj = async (req: Request, res: Response): Promise<void> => {
    const input = ChecadorRelojDto.parse(req.body);
    res.status(201).json(await this.service.registrar(input, req.user?.id));
  };

  actualizarReloj = async (req: Request, res: Response): Promise<void> => {
    const input = ChecadorRelojUpdateDto.parse(req.body);
    res.json(await this.service.actualizar(req.params.serie, input, req.user?.id));
  };

  darDeBajaReloj = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.darDeBaja(req.params.serie, req.user?.id));
  };

  configuracionReloj = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.configuracion(req.params.serie));
  };

  reporte = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.report.report(parseReportParams(req.body)));
  };

  reporteExport = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.report.reportExport(parseReportParams(req.body)));
  };

  empleadosTable = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total, summary } = await this.empleados.table(params);
    res.json({ ...paginatedTable(params, data, total), summary });
  };

  vincular = async (req: Request, res: Response): Promise<void> => {
    const { userId } = ChecadorVinculoDto.parse(req.body);
    res.json(await this.empleados.vincular(req.params.numero, userId, req.user?.id));
  };

  desvincular = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.empleados.desvincular(req.params.numero, req.user?.id));
  };

  vincularSugeridos = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.empleados.vincularSugeridos(req.user?.id));
  };
}
