import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { env } from "@core/config/env.config";
import { downloadObject, publicObjectUrl, uploadObject } from "@core/services/storage";
import { enqueueEmail, enqueueNotificationEmail } from "@core/services/email-queue";
import { documentUploadedEmail, employeeAltaEmail } from "@core/services/email-templates";
import type { NotificationPort } from "@modules/notifications";
import type { AuditPort } from "@modules/audit";
import { employeeDocumentInclude } from "../models/entity/personal.entity";

type AuditLogger = AuditPort["createLog"];

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const assertFile = (file?: Express.Multer.File) => {
  if (!file) throw new HttpError(400, "Archivo requerido");
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new HttpError(400, "Tipo de archivo no permitido (usa imagen o PDF)");
  }
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new HttpError(400, "Archivo excede el tamaño máximo permitido");
  }
  return file;
};

const sanitizeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

export class EmployeeDocumentService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly notifications?: NotificationPort
  ) {}

  private async assertUserExists(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new HttpError(404, "Personal no encontrado");
  }

  async uploadPhoto(userId: string, file?: Express.Multer.File) {
    await this.assertUserExists(userId);
    const validFile = assertFile(file);
    if (!validFile.mimetype.startsWith("image/")) {
      throw new HttpError(400, "La foto debe ser una imagen");
    }
    const key = `personal/${userId}/foto/${crypto.randomUUID()}-${sanitizeName(validFile.originalname)}`;
    await uploadObject(key, validFile.buffer, validFile.mimetype);
    await this.db.user.update({ where: { id: userId }, data: { fotoKey: key } });
    return { fotoUrl: publicObjectUrl(key) };
  }

  async downloadPhoto(userId: string): Promise<{ body: Buffer; contentType: string }> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { fotoKey: true },
    });
    if (!user?.fotoKey) {
      throw new HttpError(404, "El empleado no tiene foto");
    }
    const body = await downloadObject(user.fotoKey);
    const ext = user.fotoKey.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      "image/jpeg";
    return { body, contentType };
  }

  async listDocuments(userId: string) {
    await this.assertUserExists(userId);
    const documents = await this.db.employeeDocument.findMany({
      where: { userId },
      include: employeeDocumentInclude,
      orderBy: { createdAt: "desc" },
    });
    return documents;
  }

  async uploadDocument(
    userId: string,
    tipoDocumentoId: string,
    uploadedById: string,
    file?: Express.Multer.File
  ) {
    await this.assertUserExists(userId);
    const tipoDocumento = await this.db.tipoDocumento.findUnique({ where: { id: tipoDocumentoId } });
    if (!tipoDocumento || !tipoDocumento.activo) {
      throw new HttpError(404, "Tipo de documento inválido");
    }
    const validFile = assertFile(file);
    const key = `personal/${userId}/documentos/${tipoDocumentoId}/${crypto.randomUUID()}-${sanitizeName(validFile.originalname)}`;
    await uploadObject(key, validFile.buffer, validFile.mimetype);
    const document = await this.db.employeeDocument.create({
      data: {
        userId,
        tipoDocumentoId,
        uploadedById,
        storageKey: key,
        originalName: validFile.originalname,
        mimeType: validFile.mimetype,
        sizeBytes: validFile.size,
      },
      include: employeeDocumentInclude,
    });

    const [employee, uploader] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      }),
      this.db.user.findUnique({
        where: { id: uploadedById },
        select: { id: true, name: true, email: true },
      }),
    ]);

    const uploaderName = uploader?.name ?? "Administrador";
    const fechaCarga = new Date().toLocaleString("es-MX");

    // URL pública del documento para el cuerpo del correo (fallback si no se
    // adjunta). No debería fallar porque el upload ya usó el mismo bucket.
    let docUrl: string | undefined;
    try {
      docUrl = publicObjectUrl(document.storageKey);
    } catch {
      docUrl = undefined;
    }

    // El archivo viaja adjunto en los correos por referencia S3 (`storageKey`):
    // ya está en el bucket por el propio upload, el worker lo descarga al
    // enviar. Sin re-subir ni base64 en la cola.
    const emailAttachments = [
      {
        storageKey: document.storageKey,
        originalName: validFile.originalname,
        contentType: validFile.mimetype,
      },
    ];

    // Log de auditoría (R11 Opción A): evento EMPLOYEE_DOC_UPLOADED.
    // Fire-and-forget fuera de la transacción principal — no bloquea el
    // 201 al cliente y tolera caída del módulo de auditoría.
    void this.audit?.({
      action: "EMPLOYEE_DOC_UPLOADED",
      entityType: "EmployeeDocument",
      entityId: document.id,
      userId: uploadedById,
      metadata: { employeeId: userId, tipoNombre: tipoDocumento.nombre },
    }).catch(() => {
      /* el error ya se registra dentro del servicio de auditoría */
    });

    // Notificación in-app a admin/HR (fire-and-forget).
    void this.notifications?.notifyDocumentUploaded({
      userId,
      documentId: document.id,
      documentName: validFile.originalname,
      tipoNombre: tipoDocumento.nombre,
      actorId: uploadedById,
      userName: employee?.name ?? "Empleado",
    }).catch(() => {
      /* el error ya se registra dentro de la implementación */
    });

    // Correo al empleado afectado (fire-and-forget). Solo si tiene email propio
    // y NO es el mismo que el uploader (ruido si uno sube su propio doc).
    // `skipStakeholders: true` para que NO se una con EMAIL_NOTIFICATION_RECIPIENTS:
    // este es el correo "1/2" — el afectado recibe su versión y los admin/HR la
    // detallada aparte (abajo). Sin esto, todos recibían la misma versión simple.
    if (employee?.email && uploadedById !== employee.id) {
      const { subject, html } = documentUploadedEmail({
        to: employee.email,
        name: employee.name,
        uploader: uploaderName,
        docName: tipoDocumento.nombre,
        docUrl,
      });
      void enqueueEmail({
        to: employee.email,
        subject,
        html,
        attachments: emailAttachments,
        action: "document.uploaded",
        entityType: "EmployeeDocument",
        entityId: document.id,
      });
    }

    // Correo de registro a los NOTIFICATION_EMAILS del catálogo (sys_config).
    // Versión detallada, distinta a la del empleado: tipo, quién cargó, fecha.
    {
      const { subject, html } = documentUploadedEmail({
        to: "",
        name: employee?.name ?? "Empleado",
        uploader: uploaderName,
        docName: tipoDocumento.nombre,
        forAdmin: true,
        tipoNombre: tipoDocumento.nombre,
        fecha: fechaCarga,
        docUrl,
      });
      void enqueueNotificationEmail({
        subject,
        html,
        attachments: emailAttachments,
        action: "document.uploaded",
        entityType: "EmployeeDocument",
        entityId: document.id,
      });
    }

    return document;
  }

  async removeDocument(userId: string, documentId: string) {
    const document = await this.db.employeeDocument.findFirst({ where: { id: documentId, userId } });
    if (!document) throw new HttpError(404, "Documento no encontrado");
    await this.db.employeeDocument.delete({ where: { id: documentId } });
    return { id: documentId };
  }

  async downloadDocument(userId: string, documentId: string) {
    const document = await this.db.employeeDocument.findFirst({
      where: { id: documentId, userId },
      select: { storageKey: true, mimeType: true, originalName: true },
    });
    if (!document) throw new HttpError(404, "Documento no encontrado");
    const body = await downloadObject(document.storageKey);
    return { body, mimeType: document.mimeType, originalName: document.originalName };
  }

  /**
   * Correo de "Alta de personal": envía a los destinatarios de notificación el
   * alta del empleado con TODOS sus documentos adjuntos (por referencia S3).
   */
  async notificarAlta(userId: string, actorId?: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        numeroEmpleado: true,
        puesto: true,
        email: true,
        department: { select: { name: true } },
      },
    });
    if (!user) throw new HttpError(404, "Personal no encontrado");

    const actor = actorId
      ? await this.db.user.findUnique({ where: { id: actorId }, select: { name: true } })
      : null;

    const docs = await this.db.employeeDocument.findMany({
      where: { userId },
      select: {
        storageKey: true,
        mimeType: true,
        originalName: true,
        tipoDocumento: { select: { nombre: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const attachments = docs.map((d) => ({
      storageKey: d.storageKey,
      originalName: d.originalName,
      contentType: d.mimeType,
    }));

    const { subject, html } = employeeAltaEmail({
      name: user.name,
      numeroEmpleado: user.numeroEmpleado,
      puesto: user.puesto,
      departmentName: user.department?.name ?? null,
      email: user.email,
      createdBy: actor?.name,
      documentos: docs.map((d) => d.tipoDocumento?.nombre ?? d.originalName),
    });

    await enqueueNotificationEmail({
      subject,
      html,
      attachments,
      action: "employee.alta",
      entityType: "User",
      entityId: userId,
    });

    return { enviado: true, adjuntos: attachments.length };
  }
}