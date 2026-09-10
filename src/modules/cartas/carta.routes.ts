import { Router } from "express";
import { authenticate, authorize } from "@core/middlewares/auth.middleware";
import * as ctrl from "./carta.controller";
import { asyncHandler } from "@core/utils/asyncHandler";

const router = Router();

router.use(authenticate);

router.get("/consecutivo", asyncHandler(ctrl.getConsecutivo));
router.get("/consecutivo/peek", asyncHandler(ctrl.peek));
// Reiniciar el consecutivo altera la numeración de todas las cartas futuras: solo ADMIN.
router.post("/consecutivo/reset", authorize(["ADMIN"]), asyncHandler(ctrl.resetConsecutivoCtrl));

// Generación masiva de cartas por tipo: operación administrativa, no por empleado ni jefe de área.
router.post("/generate", authorize(["ADMIN", "GERENTE"]), asyncHandler(ctrl.generateCartas));

router.get("/", asyncHandler(ctrl.list));
router.post("/query", asyncHandler(ctrl.table));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
// Eliminar una carta (documento legal de resguardo) no debe quedar disponible a EMPLEADO.
// El servicio conserva además el filtro por propiedad/departamento para JEFE_DE_AREA.
router.delete("/:id", authorize(["ADMIN", "GERENTE", "JEFE_DE_AREA"]), asyncHandler(ctrl.remove));

router.post("/:id/return", asyncHandler(ctrl.returnCarta));
router.delete("/:id/return", asyncHandler(ctrl.undoReturn));

export default router;