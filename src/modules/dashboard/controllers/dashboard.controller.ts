import { Request, Response } from "express";
import { DashboardService } from "../services/dashboard.service";

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  summary = async (_req: Request, res: Response) => {
    const data = await this.dashboardService.summary();
    res.json(data);
  };
}
