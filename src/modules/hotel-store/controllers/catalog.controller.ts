import { Request, Response } from "express";
import {
  HotelKitCreateDto,
  HotelKitLinesDto,
  HotelKitUpdateDto,
  HotelProductCategoryCreateDto,
  HotelProductCategoryUpdateDto,
  HotelProductCreateDto,
  HotelProductUpdateDto,
  HotelUnitCreateDto,
  HotelUnitUpdateDto,
} from "../models/dto/catalog.dto";
import type { HotelCatalogService } from "../services/hotel-catalog.service";

const flag = (value: unknown): boolean => value === "true";

export class HotelCatalogController {
  constructor(private readonly catalog: HotelCatalogService) {}

  units = async (req: Request, res: Response) => {
    res.json(await this.catalog.units(flag(req.query.includeInactive)));
  };
  createUnit = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createUnit(HotelUnitCreateDto.parse(req.body)));
  };
  updateUnit = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateUnit(req.params.id, HotelUnitUpdateDto.parse(req.body)));
  };
  removeUnit = async (req: Request, res: Response) => {
    res.json(await this.catalog.removeUnit(req.params.id));
  };

  categories = async (req: Request, res: Response) => {
    res.json(await this.catalog.categories(flag(req.query.includeInactive)));
  };
  createCategory = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createCategory(HotelProductCategoryCreateDto.parse(req.body)));
  };
  updateCategory = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateCategory(req.params.id, HotelProductCategoryUpdateDto.parse(req.body)));
  };
  removeCategory = async (req: Request, res: Response) => {
    res.json(await this.catalog.removeCategory(req.params.id));
  };

  products = async (req: Request, res: Response) => {
    const kind = typeof req.query.kind === "string" ? (req.query.kind as never) : undefined;
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
    res.json(await this.catalog.products({ includeInactive: flag(req.query.includeInactive), kind, categoryId }));
  };
  createProduct = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createProduct(HotelProductCreateDto.parse(req.body)));
  };
  updateProduct = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateProduct(req.params.id, HotelProductUpdateDto.parse(req.body)));
  };
  removeProduct = async (req: Request, res: Response) => {
    res.json(await this.catalog.removeProduct(req.params.id));
  };

  kits = async (req: Request, res: Response) => {
    res.json(await this.catalog.kits(flag(req.query.includeInactive)));
  };
  createKit = async (req: Request, res: Response) => {
    res.status(201).json(await this.catalog.createKit(HotelKitCreateDto.parse(req.body)));
  };
  updateKit = async (req: Request, res: Response) => {
    res.json(await this.catalog.updateKit(req.params.id, HotelKitUpdateDto.parse(req.body)));
  };
  removeKit = async (req: Request, res: Response) => {
    res.json(await this.catalog.removeKit(req.params.id));
  };
  kitLines = async (req: Request, res: Response) => {
    res.json(await this.catalog.kitLines(req.params.id));
  };
  setKitLines = async (req: Request, res: Response) => {
    res.json(await this.catalog.setKitLines(req.params.id, HotelKitLinesDto.parse(req.body)));
  };
}
