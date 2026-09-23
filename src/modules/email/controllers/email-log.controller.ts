import { Request, Response } from "express";
import { EmailLogService } from "../services/email-log.service";

export class EmailLogController {
  constructor(private readonly svc: EmailLogService) {}

  table = async (req: Request, res: Response) => {
    const data = await this.svc.table(req.body);
    res.json(data);
  };

  retry = async (req: Request, res: Response) => {
    const data = await this.svc.retry(req.params.id);
    res.json(data);
  };

  cancel = async (req: Request, res: Response) => {
    const data = await this.svc.cancel(req.params.id);
    res.json(data);
  };
}