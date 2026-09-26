import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  PersonalProfileUpdateDto,
  EmployeeDiscountsSetDto,
  TipoDocumentoCreateDto,
  TipoDocumentoUpdateDto,
  GeneroCreateDto,
  GeneroUpdateDto,
  TipoSangreCreateDto,
  TipoSangreUpdateDto,
} from "../models/dto/personal.dto";
import { ActaAdministrativaCreateDto } from "../models/dto/acta.dto";
import { personalProfileToDto, employeeDocumentToDto } from "../mappers/personal.mapper";
import { actaAdministrativaToDto } from "../mappers/acta.mapper";
import { EmployeeProfileService } from "../services/employee-profile.service";
import { EmployeeDocumentService } from "../services/employee-document.service";
import { DocumentTypeService } from "../services/document-type.service";
import { HrCatalogService } from "../services/hr-catalog.service";
import { ActaAdministrativaService } from "../services/acta-administrativa.service";

export class PersonalController {
  constructor(
    private readonly profiles: EmployeeProfileService,
    private readonly documents: EmployeeDocumentService,
    private readonly documentTypes: DocumentTypeService,
    private readonly catalogs: HrCatalogService,
    private readonly actas: ActaAdministrativaService
  ) {}

  table = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.profiles.table(params);
    res.json(paginatedTable(params, data.map(personalProfileToDto), total));
  };

  stats = async (_req: Request, res: Response) => {
    res.json(await this.profiles.stats());
  };

  getOne = async (req: Request, res: Response) => {
    const data = await this.profiles.getById(req.params.id);
    res.json(personalProfileToDto(data));
  };

  updateProfile = async (req: Request, res: Response) => {
    const input = PersonalProfileUpdateDto.parse(req.body);
    const data = await this.profiles.updateProfile(req.params.id, input);
    res.json(personalProfileToDto(data));
  };

  setDiscounts = async (req: Request, res: Response) => {
    const input = EmployeeDiscountsSetDto.parse(req.body);
    const data = await this.profiles.setDiscounts(req.params.id, input);
    res.json(personalProfileToDto(data));
  };

  uploadPhoto = async (req: Request, res: Response) => {
    const data = await this.documents.uploadPhoto(req.params.id, req.file);
    res.json(data);
  };

  listDocuments = async (req: Request, res: Response) => {
    const data = await this.documents.listDocuments(req.params.id);
    res.json(data.map(employeeDocumentToDto));
  };

  uploadDocument = async (req: Request, res: Response) => {
    const tipoDocumentoId = String(req.body.tipoDocumentoId ?? "");
    const data = await this.documents.uploadDocument(
      req.params.id,
      tipoDocumentoId,
      req.user!.id,
      req.file
    );
    res.status(201).json(employeeDocumentToDto(data));
  };

  removeDocument = async (req: Request, res: Response) => {
    const data = await this.documents.removeDocument(req.params.id, req.params.docId);
    res.json(data);
  };

  downloadDocument = async (req: Request, res: Response) => {
    const file = await this.documents.downloadDocument(req.params.id, req.params.docId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.originalName.replace(/"/g, "")}"`);
    res.send(file.body);
  };

  notificarAlta = async (req: Request, res: Response) => {
    const data = await this.documents.notificarAlta(req.params.id, req.user?.id);
    res.json(data);
  };

  listDocumentTypes = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    const data = await this.documentTypes.list(includeInactive);
    res.json(data);
  };

  createDocumentType = async (req: Request, res: Response) => {
    const input = TipoDocumentoCreateDto.parse(req.body);
    const data = await this.documentTypes.create(input);
    res.status(201).json(data);
  };

  updateDocumentType = async (req: Request, res: Response) => {
    const input = TipoDocumentoUpdateDto.parse(req.body);
    const data = await this.documentTypes.update(req.params.id, input);
    res.json(data);
  };

  removeDocumentType = async (req: Request, res: Response) => {
    const data = await this.documentTypes.remove(req.params.id);
    res.json(data);
  };

  listGeneros = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.catalogs.listGeneros(includeInactive));
  };

  createGenero = async (req: Request, res: Response) => {
    const input = GeneroCreateDto.parse(req.body);
    const data = await this.catalogs.createGenero(input);
    res.status(201).json(data);
  };

  updateGenero = async (req: Request, res: Response) => {
    const input = GeneroUpdateDto.parse(req.body);
    const data = await this.catalogs.updateGenero(req.params.id, input);
    res.json(data);
  };

  removeGenero = async (req: Request, res: Response) => {
    const data = await this.catalogs.removeGenero(req.params.id);
    res.json(data);
  };

  listTiposSangre = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.catalogs.listTiposSangre(includeInactive));
  };

  createTipoSangre = async (req: Request, res: Response) => {
    const input = TipoSangreCreateDto.parse(req.body);
    const data = await this.catalogs.createTipoSangre(input);
    res.status(201).json(data);
  };

  updateTipoSangre = async (req: Request, res: Response) => {
    const input = TipoSangreUpdateDto.parse(req.body);
    const data = await this.catalogs.updateTipoSangre(req.params.id, input);
    res.json(data);
  };

  removeTipoSangre = async (req: Request, res: Response) => {
    const data = await this.catalogs.removeTipoSangre(req.params.id);
    res.json(data);
  };

  actasTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.actas.table(params);
    res.json(paginatedTable(params, data.map(actaAdministrativaToDto), total));
  };

  actasByEmployee = async (req: Request, res: Response) => {
    const data = await this.actas.listByEmployee(req.params.id);
    res.json(data.map(actaAdministrativaToDto));
  };

  actasGetOne = async (req: Request, res: Response) => {
    const data = await this.actas.getById(req.params.id);
    res.json(actaAdministrativaToDto(data));
  };

  actasCreate = async (req: Request, res: Response) => {
    const input = ActaAdministrativaCreateDto.parse(req.body);
    const data = await this.actas.create(input, req.user!.id);
    res.status(201).json(actaAdministrativaToDto(data));
  };

  actasRemove = async (req: Request, res: Response) => {
    const data = await this.actas.remove(req.params.id);
    res.json(data);
  };
}
