import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { systemLanguage, t, type Language } from "@core/i18n";
import { broadcastToUser } from "@core/services/ably";
import { enqueueEmail } from "@core/services/email-queue";
import type { NotificationPort } from "@modules/notifications";

/** Roles con expediente de personal (los que RH da de alta). */
const PERSONAL_ROLES: Role[] = ["MANAGER", "AREA_HEAD", "EMPLOYEE"];

/**
 * Datos personales que RH necesita en el expediente. Las claves son las
 * columnas de `users`; la web las traduce (`employees:profileFields.*`).
 */
export const PROFILE_FIELDS = [
  "curp",
  "rfc",
  "nss",
  "birthDate",
  "hireDate",
  "genderId",
  "bloodTypeId",
  "personalPhone",
  "streetAddress",
  "postalCode",
  "city",
  "emergencyContactName",
  "emergencyContactPhone",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const MISSING_RECORDS_NOTIFICATION = "HR_MISSING_RECORDS";

const personSelect = {
  id: true,
  name: true,
  employeeNumber: true,
  jobTitle: true,
  email: true,
  department: { select: { id: true, name: true } },
  documents: { select: { documentTypeId: true } },
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, true])),
} satisfies Prisma.UserSelect;

export interface EmployeeRecordGaps {
  userId: string;
  name: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** Documentos obligatorios que no tiene (INE, comprobante…). */
  missingRequired: Array<{ id: string; name: string }>;
  /** Otros documentos del catálogo que no ha entregado. */
  missingDocuments: Array<{ id: string; name: string }>;
  /** Datos personales vacíos (claves de `PROFILE_FIELDS`). */
  missingFields: ProfileField[];
  /** Catálogo completo con lo entregado, para el detalle del expediente. */
  requiredDocuments: Array<{ id: string; name: string; delivered: boolean }>;
  otherDocuments: Array<{ id: string; name: string; delivered: boolean }>;
  filledFields: ProfileField[];
}

export interface RecordsSummary {
  employees: number;
  complete: number;
  missingRequired: number;
  missingDocuments: number;
  missingFields: number;
}

const isEmpty = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/**
 * Expedientes del personal: qué documentos (obligatorios y demás) y qué datos
 * personales le faltan a cada quien. Los obligatorios los marca RH en el
 * catálogo de documentos (`DocumentType.required`); el resto del catálogo
 * activo son "otros documentos".
 */
export class EmployeeRecordsService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly notifications?: NotificationPort
  ) {}

  async gaps(where: Prisma.UserWhereInput = {}): Promise<{ summary: RecordsSummary; rows: EmployeeRecordGaps[] }> {
    const [types, people] = await Promise.all([
      this.db.documentType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      this.db.user.findMany({
        where: { role: { in: PERSONAL_ROLES }, active: true, ...where },
        select: personSelect,
        orderBy: { name: "asc" },
      }),
    ]);

    const rows = people.map((p): EmployeeRecordGaps => {
      const delivered = new Set(p.documents.map((d) => d.documentTypeId));
      const missing = types.filter((type) => !delivered.has(type.id));
      const withStatus = (required: boolean) =>
        types.filter((type) => type.required === required).map(({ id, name }) => ({ id, name, delivered: delivered.has(id) }));
      const empty = PROFILE_FIELDS.filter((f) => isEmpty((p as Record<string, unknown>)[f]));
      return {
        userId: p.id,
        name: p.name,
        employeeNumber: p.employeeNumber,
        jobTitle: p.jobTitle,
        departmentId: p.department?.id ?? null,
        departmentName: p.department?.name ?? null,
        missingRequired: missing.filter((type) => type.required).map(({ id, name }) => ({ id, name })),
        missingDocuments: missing.filter((type) => !type.required).map(({ id, name }) => ({ id, name })),
        missingFields: empty,
        requiredDocuments: withStatus(true),
        otherDocuments: withStatus(false),
        filledFields: PROFILE_FIELDS.filter((f) => !empty.includes(f)),
      };
    });

    return {
      summary: {
        employees: rows.length,
        complete: rows.filter((r) => !r.missingRequired.length && !r.missingDocuments.length && !r.missingFields.length).length,
        missingRequired: rows.filter((r) => r.missingRequired.length > 0).length,
        missingDocuments: rows.filter((r) => r.missingDocuments.length > 0).length,
        missingFields: rows.filter((r) => r.missingFields.length > 0).length,
      },
      rows,
    };
  }

  /**
   * Le avisa al empleado qué le falta de su expediente: notificación en la app
   * (y en tiempo real) y correo si tiene uno registrado.
   */
  async notifyMissing(userId: string, actorId?: string) {
    const { rows } = await this.gaps({ id: userId });
    const gaps = rows[0];
    if (!gaps) throw new HttpError(404, "EMPLOYEE_PROFILE_NOT_FOUND");
    if (!gaps.missingRequired.length && !gaps.missingDocuments.length && !gaps.missingFields.length) {
      throw new HttpError(409, "EMPLOYEE_RECORD_COMPLETE");
    }

    const lng = await systemLanguage();
    const lines = this.lines(gaps, lng);
    const title = t("hrRecords.notificationTitle", {}, lng);
    const detail = lines.join(" · ");

    await this.notifications?.createNotification({ userId, type: MISSING_RECORDS_NOTIFICATION, title, detail });
    broadcastToUser(userId, { type: MISSING_RECORDS_NOTIFICATION, title, detail, createdAt: new Date().toISOString() }).catch(() => {});

    const user = await this.db.user.findUnique({ where: { id: userId }, select: { email: true } });
    const emailed = user?.email
      ? await enqueueEmail({
          to: user.email,
          subject: `[Puerto Nuevo] ${title}`,
          html: this.emailHtml(gaps.name, lines, lng),
          action: "hr.missingRecords",
          entityType: "User",
          entityId: userId,
        })
      : false;

    return { notified: true, emailed, actorId: actorId ?? null, ...gaps };
  }

  /**
   * Aviso masivo ("Avisar a pendientes"): a cada persona de la lista con algo
   * pendiente; las que ya están completas se omiten.
   */
  async notifyMany(userIds: string[], actorId?: string) {
    const { rows } = await this.gaps({ id: { in: userIds } });
    const pending = rows.filter((r) => r.missingRequired.length || r.missingDocuments.length || r.missingFields.length);
    let emailed = 0;
    for (const r of pending) {
      const res = await this.notifyMissing(r.userId, actorId);
      if (res.emailed) emailed += 1;
    }
    return { notified: pending.length, emailed, skipped: userIds.length - pending.length };
  }

  private lines(gaps: EmployeeRecordGaps, lng: Language): string[] {
    const out: string[] = [];
    if (gaps.missingRequired.length) {
      out.push(t("hrRecords.requiredLine", { items: gaps.missingRequired.map((d) => d.name).join(", ") }, lng));
    }
    if (gaps.missingDocuments.length) {
      out.push(t("hrRecords.documentsLine", { items: gaps.missingDocuments.map((d) => d.name).join(", ") }, lng));
    }
    if (gaps.missingFields.length) {
      out.push(
        t("hrRecords.fieldsLine", { items: gaps.missingFields.map((f) => t(`hrRecords.fields.${f}`, {}, lng)).join(", ") }, lng)
      );
    }
    return out;
  }

  private emailHtml(name: string, lines: string[], lng: Language): string {
    const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return (
      `<p>${escape(t("hrRecords.emailGreeting", { name }, lng))}</p>` +
      `<p>${escape(t("hrRecords.emailIntro", {}, lng))}</p>` +
      `<ul>${lines.map((l) => `<li>${escape(l)}</li>`).join("")}</ul>` +
      `<p>${escape(t("hrRecords.emailOutro", {}, lng))}</p>`
    );
  }
}
