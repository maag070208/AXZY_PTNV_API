import { prismaClient } from "@core/config/database";
import { TicketService } from "./services/ticket.service";
import { TicketAttachmentService } from "./services/ticket-attachment.service";
import { TicketCategoryService } from "./services/ticket-category.service";
import { TicketController } from "./controllers/ticket.controller";
import { createTicketsRouter } from "./routes/ticket.routes";
import type { TicketNotificationPort } from "./models/entity/ticket.entity";

export type { TicketNotificationPort } from "./models/entity/ticket.entity";

export const createTicketsModule = (notificationPort: TicketNotificationPort) => {
  const attachmentService = new TicketAttachmentService(prismaClient);
  const ticketService = new TicketService(notificationPort, prismaClient);
  const categoryService = new TicketCategoryService(prismaClient);
  const controller = new TicketController(ticketService, attachmentService, categoryService);
  return createTicketsRouter(controller);
};

export default createTicketsModule;