import { prismaClient } from "@core/config/database";
import { TicketService } from "./services/ticket.service";
import { TicketAttachmentService } from "./services/ticket-attachment.service";
import { TicketController } from "./controllers/ticket.controller";
import { createTicketsRouter } from "./routes/ticket.routes";
import type { TicketNotificationPort } from "./models/entity/ticket.entity";

export type { TicketNotificationPort } from "./models/entity/ticket.entity";

export const createTicketsModule = (notificationPort: TicketNotificationPort) => {
  const attachmentService = new TicketAttachmentService(prismaClient);
  const ticketService = new TicketService(notificationPort, prismaClient);
  const controller = new TicketController(ticketService, attachmentService);
  return createTicketsRouter(controller);
};

export default createTicketsModule;