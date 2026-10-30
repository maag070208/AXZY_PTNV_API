import { Request, Response } from "express";
import { HttpError } from "@core/middlewares/error.middleware";
import { scopeOf } from "@core/permissions";
import {
  HotelInspectionDto,
  HotelTaskAssignDto,
  HotelTaskCreateDto,
  HotelTaskExtraDto,
} from "../models/dto/housekeeping.dto";
import type { HotelHousekeepingService } from "../services/housekeeping.service";
import type { HotelRoomsService, Caller } from "../services/rooms.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

/**
 * Housekeeping endpoints (M5). Each action checks its permission and the scope:
 * `operate` OWN works only on the caller's own tasks, AREA only inside the zones
 * the caller supervises (rooms service), and ALL everywhere.
 */
export class HotelHousekeepingController {
  constructor(
    private readonly tasks: HotelHousekeepingService,
    private readonly rooms: HotelRoomsService
  ) {}

  list = async (req: Request, res: Response) => {
    const user = req.user!;
    const operate = scopeOf(user, "housekeeping.operate");
    const assign = scopeOf(user, "housekeeping.assign");
    if (operate === "OWN" && assign === "NONE" && scopeOf(user, "housekeeping.inspect") === "NONE") {
      return res.json(await this.tasks.list({ assignedToId: user.id }));
    }
    const zoneIds = await this.zonesFor(req, "housekeeping.operate");
    res.json(await this.tasks.list({ zoneIds: zoneIds ? [...zoneIds] : null }));
  };

  create = async (req: Request, res: Response) => {
    const input = HotelTaskCreateDto.parse(req.body);
    await this.assertRoomInScope(req, input.roomId, "housekeeping.assign");
    res.status(201).json(await this.tasks.createManual(input));
  };

  get = async (req: Request, res: Response) => {
    const task = await this.tasks.get(req.params.id);
    this.assertTaskVisible(req, task.assignedToId);
    res.json(task);
  };

  assign = async (req: Request, res: Response) => {
    const task = await this.tasks.get(req.params.id);
    await this.assertRoomInScope(req, task.roomId, "housekeeping.assign");
    const { assigneeId } = HotelTaskAssignDto.parse(req.body);
    res.json(await this.tasks.assign(req.params.id, assigneeId));
  };

  start = async (req: Request, res: Response) => {
    await this.assertOperator(req);
    res.json(await this.tasks.start(req.params.id));
  };

  addExtra = async (req: Request, res: Response) => {
    await this.assertOperator(req);
    const input = HotelTaskExtraDto.parse(req.body);
    res.status(201).json(await this.tasks.addExtra(req.params.id, input));
  };

  finish = async (req: Request, res: Response) => {
    await this.assertOperator(req);
    const canManage = scopeOf(req.user!, "housekeeping.assign") !== "NONE";
    res.json(await this.tasks.finish(req.params.id, req.user!.id, canManage));
  };

  cancel = async (req: Request, res: Response) => {
    const task = await this.tasks.get(req.params.id);
    await this.assertRoomInScope(req, task.roomId, "housekeeping.assign");
    res.json(await this.tasks.cancel(req.params.id, req.user!.id));
  };

  inspect = async (req: Request, res: Response) => {
    const task = await this.tasks.get(req.params.id);
    await this.assertRoomInScope(req, task.roomId, "housekeeping.inspect");
    const input = HotelInspectionDto.parse(req.body);
    res.status(201).json(await this.tasks.inspect(req.params.id, input, req.user!.id));
  };

  /** Zone ids the caller may see under `permission` (null = all). */
  private async zonesFor(req: Request, permission: string): Promise<Set<string> | null> {
    return this.rooms.visibleZoneIds(caller(req), permission);
  }

  private async assertRoomInScope(req: Request, roomId: string, permission: string): Promise<void> {
    const zones = await this.zonesFor(req, permission);
    if (!zones) return;
    const zoneId = await this.rooms.roomZone(roomId);
    if (!zones.has(zoneId)) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }

  /** Starting, adding extras and finishing belong to the assignee, or to a supervisor. */
  private async assertOperator(req: Request): Promise<void> {
    if (scopeOf(req.user!, "housekeeping.operate") === "NONE") throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
    const task = await this.tasks.get(req.params.id);
    const supervisor = scopeOf(req.user!, "housekeeping.assign") !== "NONE";
    if (!supervisor && task.assignedToId !== req.user!.id) throw new HttpError(403, "INSUFFICIENT_PERMISSIONS");
  }

  private assertTaskVisible(req: Request, assignedToId: string | null): void {
    const operate = scopeOf(req.user!, "housekeeping.operate");
    if (operate === "OWN" && assignedToId !== req.user!.id) throw new HttpError(403, "HOTEL_ACCESS_DENIED");
  }
}
