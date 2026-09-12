import { Request, Response } from "express";
import { NotificationService } from "../services/notification.service";

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  list = async (req: Request, res: Response) => {
    const unreadOnly = req.query.unread === "true";
    const data = await this.service.listNotifications(req.user!.id, unreadOnly);
    res.json({ data, total: data.length });
  };

  unreadCount = async (_req: Request, res: Response) => {
    const count = await this.service.getUnreadCount(_req.user!.id);
    res.json({ count });
  };

  markRead = async (req: Request, res: Response) => {
    await this.service.markAsRead(req.params.id, req.user!.id);
    res.status(204).send();
  };

  markAllRead = async (req: Request, res: Response) => {
    await this.service.markAllAsRead(req.user!.id);
    res.status(204).send();
  };

  remove = async (req: Request, res: Response) => {
    await this.service.deleteNotification(req.params.id, req.user!.id);
    res.status(204).send();
  };
}