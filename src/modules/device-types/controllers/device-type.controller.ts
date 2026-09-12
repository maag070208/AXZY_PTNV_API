import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  DeviceTypeCreateDto,
  DeviceTypeUpdateDto,
} from "../models/dto/device-type.dto";
import { DeviceTypeService } from "../services/device-type.service";

export class DeviceTypeController {
  constructor(private readonly service: DeviceTypeService) {}

  list = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    const data = await this.service.list(includeInactive);
    res.json(data);
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.service.table(params);
    res.json(paginatedTable(params, data, total));
  };

  peek = async (req: Request, res: Response) => {
    const siguiente = await this.service.peekNextControlActivo(req.params.id);
    res.json({ siguiente });
  };

  peekCarta = async (req: Request, res: Response) => {
    const siguiente = await this.service.peekNextCartaFolio(req.params.id);
    res.json({ siguiente });
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.service.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = DeviceTypeCreateDto.parse(req.body);
    const data = await this.service.create(input);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const input = DeviceTypeUpdateDto.parse(req.body);
    const data = await this.service.update(req.params.id, input);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.service.remove(req.params.id);
    res.json(data);
  };
}