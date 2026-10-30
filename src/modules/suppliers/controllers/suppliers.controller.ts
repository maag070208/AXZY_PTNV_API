import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import { SupplierCreateDto, SupplierUpdateDto } from "@modules/kitchen/models/dto/kitchen.dto";
import type { SupplierService } from "@modules/kitchen/services/supplier.service";
import {
  SupplierCategoriesSetDto,
  SupplierCategoryCreateDto,
  SupplierCategoryUpdateDto,
} from "../models/dto/supplier-categories.dto";
import type { SupplierCategoriesService } from "../services/supplier-categories.service";

const actorOf = (req: Request): string | undefined => req.user?.id;

export class SuppliersController {
  constructor(
    private readonly suppliers: SupplierService,
    private readonly categories: SupplierCategoriesService
  ) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.suppliers.list(req.query.includeInactive === "true"));
  };
  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.suppliers.table(params);
    res.json(paginatedTable(params, data, total));
  };
  detail = async (req: Request, res: Response) => {
    res.json(await this.suppliers.detail(req.params.id));
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.suppliers.create(SupplierCreateDto.parse(req.body), actorOf(req)));
  };
  update = async (req: Request, res: Response) => {
    res.json(await this.suppliers.update(req.params.id, SupplierUpdateDto.parse(req.body), actorOf(req)));
  };
  setCategories = async (req: Request, res: Response) => {
    res.json(await this.categories.setForSupplier(req.params.id, SupplierCategoriesSetDto.parse(req.body)));
  };

  listCategories = async (req: Request, res: Response) => {
    res.json(await this.categories.list(req.query.includeInactive === "true"));
  };
  createCategory = async (req: Request, res: Response) => {
    res.status(201).json(await this.categories.create(SupplierCategoryCreateDto.parse(req.body)));
  };
  updateCategory = async (req: Request, res: Response) => {
    res.json(await this.categories.update(req.params.id, SupplierCategoryUpdateDto.parse(req.body)));
  };
  removeCategory = async (req: Request, res: Response) => {
    res.json(await this.categories.remove(req.params.id));
  };
}
