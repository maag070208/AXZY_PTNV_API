import { prismaClient } from "@core/config/database";
import { DepartmentService } from "./services/department.service";
import { SubareaService } from "./services/subarea.service";
import { DepartmentController } from "./controllers/department.controller";
import { SubareaController } from "./controllers/subarea.controller";
import { createDepartmentRouter } from "./routes/department.routes";
import { createSubareaRouter } from "./routes/subarea.routes";

export { DepartmentService } from "./services/department.service";
export { SubareaService } from "./services/subarea.service";

export const createDepartmentModule = () => {
  const departments = new DepartmentService(prismaClient);
  const subareas = new SubareaService(prismaClient);
  const departmentController = new DepartmentController(departments);
  const subareaController = new SubareaController(subareas);
  return {
    departmentRouter: createDepartmentRouter(departmentController),
    subareaRouter: createSubareaRouter(subareaController),
  };
};

export default createDepartmentModule;
