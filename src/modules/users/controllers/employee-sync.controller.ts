import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import {
  EmployeeSyncConfirmDto,
  EmployeeSyncExportDto,
} from "../models/dto/employee-sync.dto";
import { EmployeeSyncService } from "../services/employee-sync.service";

/**
 * Sincronización de empleados desde el Excel oficial de nómina.
 *
 * - `preview`: sube el archivo y NO escribe nada.
 * - `confirm`: aplica lo que RH revisó (altas/bajas/cambios) y propaga al reloj.
 * - `export`: regresa el reporte revisado en Excel.
 */
export class EmployeeSyncController {
  constructor(private readonly service: EmployeeSyncService) {}

  preview = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "EXCEL_FILE_REQUIRED");
    res.json(await this.service.preview(req.file.buffer, req.user?.id));
  };

  confirm = async (req: Request, res: Response) => {
    const input = EmployeeSyncConfirmDto.parse(req.body);
    // Escribir en el reloj exige su propio permiso y que la pantalla lo pida
    // (`clockNow`): sin eso la sincronización del sistema sí se aplica, pero el
    // padrón queda pendiente (y la respuesta llega rápido).
    const clockEnabled = req.user
      ? scopeOf(req.user, "time_clock.write") !== "NONE" && input.clockNow
      : false;
    res.json(await this.service.confirm(input, req.user!.id, { clockEnabled }));
  };

  export = async (req: Request, res: Response) => {
    const { rows } = EmployeeSyncExportDto.parse(req.body);
    const buffer = this.service.export(rows);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sincronizacion-empleados.xlsx"'
    );
    res.send(buffer);
  };
}
