import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  LocationCreateDto,
  LocationUpdateDto,
  SublugarCreateDto,
} from "../models/dto/location.dto";
import { LocationService } from "../services/location.service";
import { SublugarService } from "../services/sublugar.service";

export class LocationController {
  constructor(
    private readonly locations: LocationService,
    private readonly sublugares: SublugarService
  ) {}

  list = async (req: Request, res: Response) => {
    const include = req.query.includeInactive === "true";
    const data = await this.locations.list(include);
    res.json(data);
  };

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.locations.table(params);
    res.json(paginatedTable(params, data, total));
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.locations.getById(req.params.id);
    res.json(data);
  };

  create = async (req: Request, res: Response) => {
    const input = LocationCreateDto.parse(req.body);
    const data = await this.locations.create(input);
    res.status(201).json(data);
  };

  update = async (req: Request, res: Response) => {
    const input = LocationUpdateDto.parse(req.body);
    const data = await this.locations.update(req.params.id, input);
    res.json(data);
  };

  remove = async (req: Request, res: Response) => {
    const data = await this.locations.remove(req.params.id);
    res.json(data);
  };

  addSublugar = async (req: Request, res: Response) => {
    const input = SublugarCreateDto.parse(req.body);
    const data = await this.sublugares.create(req.params.id, input);
    res.status(201).json(data);
  };

  removeSublugar = async (req: Request, res: Response) => {
    const data = await this.sublugares.remove(req.params.id);
    res.json(data);
  };
}