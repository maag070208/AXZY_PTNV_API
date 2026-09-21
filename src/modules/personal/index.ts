import { prismaClient } from "@core/config/database";
import { EmployeeProfileService } from "./services/employee-profile.service";
import { EmployeeDocumentService } from "./services/employee-document.service";
import { DocumentTypeService } from "./services/document-type.service";
import { HrCatalogService } from "./services/hr-catalog.service";
import { ActaAdministrativaService } from "./services/acta-administrativa.service";
import { PersonalController } from "./controllers/personal.controller";
import { createPersonalRouter } from "./routes/personal.routes";

export { EmployeeProfileService } from "./services/employee-profile.service";
export { EmployeeDocumentService } from "./services/employee-document.service";
export { DocumentTypeService } from "./services/document-type.service";
export { HrCatalogService } from "./services/hr-catalog.service";
export { ActaAdministrativaService } from "./services/acta-administrativa.service";

export const createPersonalModule = () => {
  const profiles = new EmployeeProfileService(prismaClient);
  const documents = new EmployeeDocumentService(prismaClient);
  const documentTypes = new DocumentTypeService(prismaClient);
  const catalogs = new HrCatalogService(prismaClient);
  const actas = new ActaAdministrativaService(prismaClient);
  const controller = new PersonalController(profiles, documents, documentTypes, catalogs, actas);
  return createPersonalRouter(controller);
};

export default createPersonalModule;
