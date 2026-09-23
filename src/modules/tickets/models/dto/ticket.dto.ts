import { z } from "zod";
import { registry } from "@core/swagger/registry";
import { TableQuerySchema, paginatedTableResponseSchema } from "@core/swagger/table.dto";

export const TicketCreateSchema = registry.register(
  "TicketCreateInput",
  z.object({
    titulo: z.string().min(3).max(150),
    descripcion: z.string().min(3),
    priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
    categoryId: z.string().optional(),
    departmentId: z.string().optional(),
    asignadoAId: z.string().optional(),
  })
);

export const TicketUpdateSchema = registry.register(
  "TicketUpdateInput",
  z.object({
    status: z.enum(["ABIERTO", "EN_SEGUIMIENTO", "CERRADO"]).optional(),
    priority: z.enum(["BAJA", "MEDIA", "ALTA", "URGENTE"]).optional(),
    categoryId: z.string().nullable().optional(),
    asignadoAId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
  })
);

export const TicketCommentSchema = registry.register(
  "TicketCommentInput",
  z.object({ texto: z.string().min(1) }).openapi("TicketCommentInput")
);

export const TicketAssignmentCreateSchema = registry.register(
  "TicketAssignmentCreateInput",
  z
    .object({
      userId: z.string().min(1),
      title: z.string().min(1).max(200),
      description: z.string().max(1000).optional().default(""),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
    })
    .openapi("TicketAssignmentCreateInput")
);

export const TicketAssignmentUpdateSchema = registry.register(
  "TicketAssignmentUpdateInput",
  z
    .object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      status: z.enum(["PENDIENTE", "EN_PROGRESO", "EN_REVISION", "COMPLETADA"]).optional(),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
    })
    .openapi("TicketAssignmentUpdateInput")
);

export const TicketAssignmentCommentSchema = registry.register(
  "TicketAssignmentCommentInput",
  z.object({ texto: z.string().min(1).max(1000) }).openapi("TicketAssignmentCommentInput")
);

export const TicketCategorySchema = registry.register(
  "TicketCategory",
  z
    .object({
      id: z.string(),
      nombre: z.string(),
      activo: z.boolean(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .openapi("TicketCategory")
);

export const TicketCategoryCreateDto = registry.register(
  "TicketCategoryCreateInput",
  z.object({ nombre: z.string().min(1) }).openapi("TicketCategoryCreateInput")
);

export const TicketCategoryUpdateDto = registry.register(
  "TicketCategoryUpdateInput",
  z
    .object({ nombre: z.string().min(1).optional(), activo: z.boolean().optional() })
    .openapi("TicketCategoryUpdateInput")
);

export const TicketSchema = registry.register(
  "Ticket",
  z
    .object({
      id: z.string(),
      titulo: z.string(),
      descripcion: z.string(),
      status: z.string(),
      priority: z.string(),
      categoryId: z.string().nullable(),
      category: z.record(z.string(), z.unknown()).nullable().optional(),
      departmentId: z.string().nullable(),
      creadoPorId: z.string(),
      asignadoAId: z.string().nullable(),
      closedAt: z.string().nullable(),
      closedBy: z.string().nullable(),
      deletedAt: z.string().nullable(),
      creadoEn: z.string(),
      creadoPor: z.record(z.string(), z.unknown()).nullable().optional(),
      asignadoA: z.record(z.string(), z.unknown()).nullable().optional(),
      department: z.record(z.string(), z.unknown()).nullable().optional(),
      assignments: z.array(z.record(z.string(), z.unknown())).optional(),
      comments: z.array(z.record(z.string(), z.unknown())).optional(),
      history: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .openapi("Ticket")
);

export const TicketAttachmentSchema = registry.register(
  "TicketAttachment",
  z
    .object({
      id: z.string(),
      originalName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      kind: z.string(),
      createdAt: z.string(),
      uploadedById: z.string(),
      assignmentId: z.string().nullable(),
      url: z.string(),
    })
    .openapi("TicketAttachment")
);

export const TicketTableResponseSchema = paginatedTableResponseSchema(TicketSchema, "TicketTableResponse");

export const TicketListResponseSchema = z
  .object({ data: z.array(TicketSchema), total: z.number() })
  .openapi("TicketListResponse");
registry.register("TicketListResponse", TicketListResponseSchema);

export const TicketQueryListSchema = TableQuerySchema;

export const TicketDeleteResponseSchema = registry.register(
  "TicketDeleteResponse",
  z
    .object({
      soft: z.boolean(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi("TicketDeleteResponse")
);

export const KanbanResponseSchema = z
  .object({ data: z.array(z.record(z.string(), z.unknown())), total: z.number() })
  .openapi("KanbanResponse");
registry.register("KanbanResponse", KanbanResponseSchema);