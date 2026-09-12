import { Request, Response } from "express";
import { LocationCreateDto, LocationUpdateDto } from "../models/dto/location.dto";
import { LocationService } from "../services/location.service";

export class LocationController {
  constructor(private readonly service: LocationService) {}

  list = async (_req: Request, res: Response) => {
    const locations = await this.service.list();
    res.json(locations);
  };

  getOne = async (req: Request, res: Response) => {
    const loc = await this.service.getById(req.params.id);
    res.json(loc);
  };

  create = async (req: Request, res: Response) => {
    const input = LocationCreateDto.parse(req.body);
    const loc = await this.service.create(input);
    res.status(201).json(loc);
  };

  update = async (req: Request, res: Response) => {
    const input = LocationUpdateDto.parse(req.body);
    const loc = await this.service.update(req.params.id, input);
    res.json(loc);
  };

  remove = async (req: Request, res: Response) => {
    await this.service.remove(req.params.id);
    res.json({ success: true });
  };
}