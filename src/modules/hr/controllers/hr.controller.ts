import { Request, Response } from "express";
import { parseTableParams, paginatedTable } from "@core/utils/table";
import {
  PersonalProfileUpdateDto,
  EmployeeDiscountsSetDto,
  DocumentTypeCreateDto,
  DocumentTypeUpdateDto,
  GenderCreateDto,
  GenderUpdateDto,
  BloodTypeCreateDto,
  BloodTypeUpdateDto,
} from "../models/dto/hr.dto";
import { DisciplinaryReportCreateDto } from "../models/dto/disciplinary-report.dto";
import { personalProfileToDto, employeeDocumentToDto } from "../mappers/hr.mapper";
import { disciplinaryReportToDto } from "../mappers/disciplinary-report.mapper";
import { EmployeeProfileService } from "../services/employee-profile.service";
import { EmployeeDocumentService } from "../services/employee-document.service";
import { DocumentTypeService } from "../services/document-type.service";
import { HrCatalogService } from "../services/hr-catalog.service";
import { DisciplinaryReportService } from "../services/disciplinary-report.service";

export class PersonalController {
  constructor(
    private readonly profiles: EmployeeProfileService,
    private readonly documents: EmployeeDocumentService,
    private readonly documentTypes: DocumentTypeService,
    private readonly catalogs: HrCatalogService,
    private readonly disciplinaryReports: DisciplinaryReportService
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
    const documentTypeId = String(req.body.documentTypeId ?? "");
    const data = await this.documents.uploadDocument(
      req.params.id,
      documentTypeId,
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

  notifyRegistration = async (req: Request, res: Response) => {
    const data = await this.documents.notifyRegistration(req.params.id, req.user?.id);
    res.json(data);
  };

  listDocumentTypes = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    const data = await this.documentTypes.list(includeInactive);
    res.json(data);
  };

  createDocumentType = async (req: Request, res: Response) => {
    const input = DocumentTypeCreateDto.parse(req.body);
    const data = await this.documentTypes.create(input);
    res.status(201).json(data);
  };

  updateDocumentType = async (req: Request, res: Response) => {
    const input = DocumentTypeUpdateDto.parse(req.body);
    const data = await this.documentTypes.update(req.params.id, input);
    res.json(data);
  };

  removeDocumentType = async (req: Request, res: Response) => {
    const data = await this.documentTypes.remove(req.params.id);
    res.json(data);
  };

  listGenders = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.catalogs.listGenders(includeInactive));
  };

  createGender = async (req: Request, res: Response) => {
    const input = GenderCreateDto.parse(req.body);
    const data = await this.catalogs.createGender(input);
    res.status(201).json(data);
  };

  updateGender = async (req: Request, res: Response) => {
    const input = GenderUpdateDto.parse(req.body);
    const data = await this.catalogs.updateGender(req.params.id, input);
    res.json(data);
  };

  removeGender = async (req: Request, res: Response) => {
    const data = await this.catalogs.removeGender(req.params.id);
    res.json(data);
  };

  listBloodTypes = async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === "true";
    res.json(await this.catalogs.listBloodTypes(includeInactive));
  };

  createBloodType = async (req: Request, res: Response) => {
    const input = BloodTypeCreateDto.parse(req.body);
    const data = await this.catalogs.createBloodType(input);
    res.status(201).json(data);
  };

  updateBloodType = async (req: Request, res: Response) => {
    const input = BloodTypeUpdateDto.parse(req.body);
    const data = await this.catalogs.updateBloodType(req.params.id, input);
    res.json(data);
  };

  removeBloodType = async (req: Request, res: Response) => {
    const data = await this.catalogs.removeBloodType(req.params.id);
    res.json(data);
  };

  disciplinaryReportsTable = async (req: Request, res: Response) => {
    const params = parseTableParams(req.body);
    const { data, total } = await this.disciplinaryReports.table(params);
    res.json(paginatedTable(params, data.map(disciplinaryReportToDto), total));
  };

  disciplinaryReportsByEmployee = async (req: Request, res: Response) => {
    const data = await this.disciplinaryReports.listByEmployee(req.params.id);
    res.json(data.map(disciplinaryReportToDto));
  };

  disciplinaryReportsGetOne = async (req: Request, res: Response) => {
    const data = await this.disciplinaryReports.getById(req.params.id);
    res.json(disciplinaryReportToDto(data));
  };

  disciplinaryReportsCreate = async (req: Request, res: Response) => {
    const input = DisciplinaryReportCreateDto.parse(req.body);
    const data = await this.disciplinaryReports.create(input, req.user!.id);
    res.status(201).json(disciplinaryReportToDto(data));
  };

  disciplinaryReportsRemove = async (req: Request, res: Response) => {
    const data = await this.disciplinaryReports.remove(req.params.id);
    res.json(data);
  };
}
