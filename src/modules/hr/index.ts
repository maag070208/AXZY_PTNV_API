import { prismaClient } from "@core/config/database";
import { EmployeeProfileService } from "./services/employee-profile.service";
import { EmployeeDocumentService } from "./services/employee-document.service";
import { DocumentTypeService } from "./services/document-type.service";
import { HrCatalogService } from "./services/hr-catalog.service";
import { DisciplinaryReportService } from "./services/disciplinary-report.service";
import { PersonalController } from "./controllers/hr.controller";
import { createPersonalRouter } from "./routes/hr.routes";
import type { NotificationPort } from "@modules/notifications";
import type { AuditPort } from "@modules/audit";

export { EmployeeProfileService } from "./services/employee-profile.service";
export { EmployeeDocumentService } from "./services/employee-document.service";
export { DocumentTypeService } from "./services/document-type.service";
export { HrCatalogService } from "./services/hr-catalog.service";
export { DisciplinaryReportService } from "./services/disciplinary-report.service";

type AuditLogger = AuditPort["createLog"];

/**
 * @param notifications Puerto de notificaciones opcional (DIP). Si se inyecta,
 * la carga de documentos dispara notificación in-app a admin/HR además del
 * correo al empleado.
 * @param audit Puerto de auditoría opcional (DIP, R11 Opción A). Si se inyecta,
 * la carga de documentos se registra como acción `EMPLOYEE_DOC_UPLOADED`.
 */
export const createPersonalModule = (
  notifications?: NotificationPort,
  audit?: AuditLogger
) => {
  const profiles = new EmployeeProfileService(prismaClient);
  const documents = new EmployeeDocumentService(prismaClient, audit, notifications);
  const documentTypes = new DocumentTypeService(prismaClient);
  const catalogs = new HrCatalogService(prismaClient);
  const disciplinaryReports = new DisciplinaryReportService(prismaClient);
  const controller = new PersonalController(profiles, documents, documentTypes, catalogs, disciplinaryReports);
  return createPersonalRouter(controller);
};

export default createPersonalModule;