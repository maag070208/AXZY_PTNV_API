import { Request, Response } from "express";
import {
  HotelRoomCreateDto,
  HotelRoomStatusDto,
  HotelRoomTypeCreateDto,
  HotelRoomTypeUpdateDto,
  HotelRoomUpdateDto,
  HotelReasonCreateDto,
  HotelReasonUpdateDto,
  HotelRoomStatusTransitionCreateDto,
  HotelRoomStatusTransitionUpdateDto,
  HotelZoneCreateDto,
  HotelZoneUpdateDto,
} from "../models/dto/rooms.dto";
import type { Caller, HotelRoomsService } from "../services/rooms.service";

const caller = (req: Request): Caller => req.user as unknown as Caller;

export class HotelRoomsController {
  constructor(private readonly rooms: HotelRoomsService) {}

  zones = async (req: Request, res: Response) => {
    res.json(await this.rooms.zones(caller(req), req.query.includeInactive === "true"));
  };

  createZone = async (req: Request, res: Response) => {
    const input = HotelZoneCreateDto.parse(req.body);
    res.status(201).json(await this.rooms.createZone(input));
  };

  updateZone = async (req: Request, res: Response) => {
    const input = HotelZoneUpdateDto.parse(req.body);
    res.json(await this.rooms.updateZone(caller(req), req.params.id, input));
  };

  removeZone = async (req: Request, res: Response) => {
    res.json(await this.rooms.removeZone(caller(req), req.params.id));
  };

  setSupervisors = async (req: Request, res: Response) => {
    const userIds = Array.isArray(req.body?.userIds) ? (req.body.userIds as string[]) : [];
    res.json(await this.rooms.setZoneSupervisors(caller(req), req.params.id, userIds));
  };

  roomTypes = async (req: Request, res: Response) => {
    res.json(await this.rooms.roomTypes(req.query.includeInactive === "true"));
  };

  createRoomType = async (req: Request, res: Response) => {
    const input = HotelRoomTypeCreateDto.parse(req.body);
    res.status(201).json(await this.rooms.createRoomType(input));
  };

  updateRoomType = async (req: Request, res: Response) => {
    const input = HotelRoomTypeUpdateDto.parse(req.body);
    res.json(await this.rooms.updateRoomType(caller(req), req.params.id, input));
  };

  removeRoomType = async (req: Request, res: Response) => {
    res.json(await this.rooms.removeRoomType(caller(req), req.params.id));
  };

  listRooms = async (req: Request, res: Response) => {
    const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(
      await this.rooms.rooms(caller(req), {
        zoneId,
        status,
        includeInactive: req.query.includeInactive === "true",
      })
    );
  };

  createRoom = async (req: Request, res: Response) => {
    const input = HotelRoomCreateDto.parse(req.body);
    res.status(201).json(await this.rooms.createRoom(caller(req), input));
  };

  updateRoom = async (req: Request, res: Response) => {
    const input = HotelRoomUpdateDto.parse(req.body);
    res.json(await this.rooms.updateRoom(caller(req), req.params.id, input));
  };

  removeRoom = async (req: Request, res: Response) => {
    res.json(await this.rooms.removeRoom(caller(req), req.params.id));
  };

  changeStatus = async (req: Request, res: Response) => {
    const input = HotelRoomStatusDto.parse(req.body);
    res.json(await this.rooms.changeStatus(caller(req), req.params.id, input));
  };

  history = async (req: Request, res: Response) => {
    res.json(await this.rooms.history(req.params.id));
  };

  board = async (req: Request, res: Response) => {
    res.json(await this.rooms.board(caller(req)));
  };

  statusTransitions = async (_req: Request, res: Response) => {
    res.json(await this.rooms.statusTransitions());
  };

  createStatusTransition = async (req: Request, res: Response) => {
    const input = HotelRoomStatusTransitionCreateDto.parse(req.body);
    res.status(201).json(await this.rooms.createStatusTransition(caller(req), input));
  };

  updateStatusTransition = async (req: Request, res: Response) => {
    const input = HotelRoomStatusTransitionUpdateDto.parse(req.body);
    res.json(await this.rooms.updateStatusTransition(caller(req), req.params.id, input));
  };

  removeStatusTransition = async (req: Request, res: Response) => {
    res.json(await this.rooms.removeStatusTransition(caller(req), req.params.id));
  };

  reasons = async (req: Request, res: Response) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    res.json(await this.rooms.reasons(kind));
  };

  createReason = async (req: Request, res: Response) => {
    const input = HotelReasonCreateDto.parse(req.body);
    res.status(201).json(await this.rooms.createReason(caller(req), input));
  };

  updateReason = async (req: Request, res: Response) => {
    const input = HotelReasonUpdateDto.parse(req.body);
    res.json(await this.rooms.updateReason(caller(req), req.params.id, input));
  };

  removeReason = async (req: Request, res: Response) => {
    res.json(await this.rooms.removeReason(caller(req), req.params.id));
  };
}
