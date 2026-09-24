import { Request, Response } from "express";
import { parseTableParams } from "@core/utils/table";
import { OvertimeService } from "../services/overtime.service";
import { OvertimeApprovalSchema } from "../models/dto/overtime.dto";

export class OvertimeController {
  constructor(private readonly service: OvertimeService) {}

  query = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.query(parseTableParams(req.body)));
  };

  decide = async (req: Request, res: Response): Promise<void> => {
    const input = OvertimeApprovalSchema.parse(req.body);
    res.json(await this.service.decide(input, req.user?.id));
  };
}
