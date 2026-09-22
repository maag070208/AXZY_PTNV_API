import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { env } from "@core/config/env.config";
import { downloadObject, publicObjectUrl, uploadObject } from "@core/services/storage";
import { sendEmail } from "@core/services/mail";
import { documentUploadedEmail } from "@core/services/email-templates";
import { employeeDocumentInclude } from "../models/entity/personal.entity";

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
  constructor(private readonly db: PrismaClient = prismaClient) {}

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

    // Notificación al empleado (fire-and-forget). Solo si tiene email propio.
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

    // No se envía correo cuando el empleado carga su propio documento (ruido).
    if (employee?.email && uploadedById !== employee.id) {
      const { subject, html } = documentUploadedEmail({
        to: employee.email,
        name: employee.name,
        uploader: uploader?.name ?? "Administrador",
        docName: tipoDocumento.nombre,
      });
      void sendEmail({ to: employee.email, subject, html }).catch(() => {
        /* sendEmail ya loguea el error */
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
}
