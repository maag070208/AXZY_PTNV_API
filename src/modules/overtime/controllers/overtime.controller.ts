import { Request, Response } from "express";
import { parseTableParams } from "@core/utils/table";
import { OvertimeService } from "../services/overtime.service";
import { OvertimeApprovalSchema } from "../models/dto/overtime.dto";

export class OvertimeController {
  constructor(private readonly service: OvertimeService) {}

  query = async (req: Request, res: Response): Promise<void> => {
    // RH solo ve lo aprobado: el filtro se fuerza en el servicio, no en la UI.
    const onlyApproved = req.user?.role === "HUMAN_RESOURCES";
    res.json(await this.service.query(parseTableParams(req.body), onlyApproved));
  };

  decide = async (req: Request, res: Response): Promise<void> => {
    const input = OvertimeApprovalSchema.parse(req.body);
    res.json(await this.service.decide(input, req.user?.id));
  };
}
