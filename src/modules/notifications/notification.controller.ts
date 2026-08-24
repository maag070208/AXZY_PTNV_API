import { Request, Response } from "express";
import * as service from "./notification.service";

export const list = async (req: Request, res: Response) => {
  const unreadOnly = req.query.unread === "true";
  const data = await service.listNotifications(req.user!.id, unreadOnly);
  res.json({ data, total: data.length });
};

export const unreadCount = async (req: Request, res: Response) => {
  const count = await service.getUnreadCount(req.user!.id);
  res.json({ count });
};

export const markRead = async (req: Request, res: Response) => {
  await service.markAsRead(req.params.id, req.user!.id);
  res.status(204).send();
};

export const markAllRead = async (req: Request, res: Response) => {
  await service.markAllAsRead(req.user!.id);
  res.status(204).send();
};

export const remove = async (req: Request, res: Response) => {
  await service.deleteNotification(req.params.id, req.user!.id);
  res.status(204).send();
};
