import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import type { UserPermissions } from "@core/permissions";
import { DashboardService } from "../services/dashboard.service";
import type { PeopleDashboardService } from "../services/people-dashboard.service";
import type { WorkDashboardService } from "../services/work-dashboard.service";

export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly people: PeopleDashboardService,
    private readonly work: WorkDashboardService
  ) {}

  private actor(req: Request): UserPermissions {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED");
    return { id: req.user.id, role: req.user.role, departmentId: req.user.departmentId };
  }

  summary = async (_req: Request, res: Response) => {
    const data = await this.dashboardService.summary();
    res.json(data);
  };

  hrRecords = async (_req: Request, res: Response) => {
    res.json(await this.people.hrRecords());
  };

  peopleOverview = async (req: Request, res: Response) => {
    res.json(await this.people.people(this.actor(req)));
  };

  attendanceToday = async (req: Request, res: Response) => {
    res.json(await this.people.attendanceToday(this.actor(req)));
  };

  overtimeWeek = async (_req: Request, res: Response) => {
    res.json(await this.people.overtimeWeek());
  };

  setupGaps = async (_req: Request, res: Response) => {
    res.json(await this.people.setupGaps());
  };

  tickets = async (req: Request, res: Response) => {
    res.json(await this.work.tickets(this.actor(req)));
  };

  tasks = async (req: Request, res: Response) => {
    res.json(await this.work.tasks(this.actor(req)));
  };

  myEquipment = async (req: Request, res: Response) => {
    res.json(await this.work.myEquipment(this.actor(req)));
  };

  accessToday = async (req: Request, res: Response) => {
    res.json(await this.work.accessToday(this.actor(req)));
  };

  systemHealth = async (_req: Request, res: Response) => {
    res.json(await this.work.systemHealth());
  };
}
