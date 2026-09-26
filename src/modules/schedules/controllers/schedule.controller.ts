import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { HorarioService } from "../services/horario.service";
import { AsignacionCreateDto, AsignacionQuitarDto, HorarioCreateDto, HorarioUpdateDto } from "../models/dto/horario.dto";

export class HorarioController {
  constructor(private readonly service: HorarioService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.service.list(includeInactive));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const input = HorarioCreateDto.parse(req.body);
    res.status(201).json(await this.service.create(input));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const input = HorarioUpdateDto.parse(req.body);
    res.json(await this.service.update(req.params.id, input));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.remove(req.params.id));
  };

  asignar = async (req: Request, res: Response): Promise<void> => {
    const input = AsignacionCreateDto.parse(req.body);
    res.status(201).json(await this.service.asignarMasivo(input, req.user?.id));
  };

  quitar = async (req: Request, res: Response): Promise<void> => {
    const input = AsignacionQuitarDto.parse(req.body);
    res.json(await this.service.quitarMasivo(input, req.user?.id));
  };

  asignados = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.asignadosDeHorario(req.params.id));
  };

  asignacionesTable = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.asignacionesTable(params);
    res.json(paginatedTable(params, data, total));
  };

  horasExtra = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    res.json(await this.service.horasExtra(params));
  };

  horasExtraExport = async (req: Request, res: Response): Promise<void> => {
    const params = parseTableParams(req.body);
    // El export de la pantalla única de tiempo extra muestra SOLO lo aprobado.
    res.json(await this.service.horasExtraExport(params, true));
  };
}
