import { prismaClient } from "@core/config/database";
import { DepartmentService } from "./services/department.service";
import { SubareaService } from "./services/subarea.service";
import { DepartmentController } from "./controllers/department.controller";
import { createDepartmentRouter } from "./routes/department.routes";

export { DepartmentService } from "./services/department.service";
export { SubareaService } from "./services/subarea.service";

export const createDepartmentModule = () => {
  const departments = new DepartmentService(prismaClient);
  const subareas = new SubareaService(prismaClient);
  const controller = new DepartmentController(departments, subareas);
  return createDepartmentRouter(controller);
};

export default createDepartmentModule;