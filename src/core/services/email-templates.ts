/**
 * Plantillas de email, en el idioma que indique cada llamada (el del sistema,
 * `sys_config.LANGUAGE`). HTML con escape de variables dinámicas para evitar
 * XSS por contenido controlado por el usuario.
 *
 * Diseño alineado con `web/src/shared/pdf/theme.ts#PDF_COLORS` (banda azul
 * `#0a4560`, acento `#5fb8dd`, cards con borde superior). Outlook-safe:
 * solo `<table>`/`<tr>`/`<td>` con estilos inline — nada de flex/grid.
 */

import { formatDateTime, t, type Language } from "@core/i18n";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Paleta espejada de web/src/shared/pdf/theme.ts → PDF_COLORS.
const EMAIL_COLORS = {
  band: "#0a4560",
  bandAccent: "#5fb8dd",
  bandSubtitle: "#bfe0f0",
  ink: "#0f172a",
  muted: "#64748b",
  light: "#f1f5f9",
  border: "#e2e8f0",
  white: "#ffffff",
  pageBg: "#f8fafc",
  success: "#15803d",
  successBg: "#dcfce7",
  warning: "#b45309",
  warningBg: "#fef3c7",
  danger: "#dc2626",
  dangerBg: "#fee2e2",
} as const;

type CardVariant = "default" | "danger" | "success" | "warning";

/**
 * CID del logo inline de Puerto Nuevo. El HTML de cada template referencia
 * `<img src="cid:EMAIL_LOGO_CID">`; `mail.ts` adjunta el PNG con ese `cid`,
 * porque Gmail/Outlook descartan las imágenes `data:` URI.
 */
export const EMAIL_LOGO_CID = "puerto-nuevo-logo";

const CARD_VARIANT_STYLES: Record<CardVariant, { bg: string; border: string }> = {
  default: { bg: EMAIL_COLORS.light, border: EMAIL_COLORS.band },
  danger: { bg: EMAIL_COLORS.dangerBg, border: EMAIL_COLORS.danger },
  success: { bg: EMAIL_COLORS.successBg, border: EMAIL_COLORS.success },
  warning: { bg: EMAIL_COLORS.warningBg, border: EMAIL_COLORS.warning },
};

interface CardInput {
  title?: string;
  content: string;
  variant?: CardVariant;
}

const card = ({ title, content, variant = "default" }: CardInput): string => {
  const v = CARD_VARIANT_STYLES[variant];
  const titleBlock = title
    ? `<div style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:${EMAIL_COLORS.muted};text-transform:uppercase;letter-spacing:0.4px;">${escapeHtml(title)}</div>`
    : "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;background:${v.bg};border-top:2.5px solid ${v.border};border-radius:6px;">
      <td style="padding:16px;">
        ${titleBlock}
        <div style="font-size:14px;line-height:1.55;color:${EMAIL_COLORS.ink};">
          ${content}
        </div>
      </td>
    </table>
  `;
};

interface LayoutInput {
  language: Language;
  title: string;
  preview?: string;
  content: string;
}

const layoutEmail = ({ language, title, preview, content }: LayoutInput): string => {
  const previewBlock = preview
    ? `<p style="margin:0 0 16px 0;font-size:14px;color:${EMAIL_COLORS.muted};">${escapeHtml(preview)}</p>`
    : "";
  return `
<!doctype html>
<html lang="${language}">
  <body style="margin:0;padding:0;background:${EMAIL_COLORS.pageBg};font-family:Arial,Helvetica,sans-serif;color:${EMAIL_COLORS.ink};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL_COLORS.pageBg};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:${EMAIL_COLORS.white};border-radius:12px;overflow:hidden;">

            <!-- Banda superior (header) -->
            <tr>
              <td style="background:${EMAIL_COLORS.band};padding:18px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td valign="vertical" width="48" style="width:48px;">
                      <img src="cid:${EMAIL_LOGO_CID}" alt="Puerto Nuevo" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:50%;background:${EMAIL_COLORS.white};border:0;outline:none;text-decoration:none;"/>
                    </td>
                    <td valign="vertical" style="padding-left:12px;">
                      <div style="font-size:16px;font-weight:700;color:${EMAIL_COLORS.white};line-height:1.2;">Puerto Nuevo Hotel y Villas</div>
                      <div style="font-size:11px;color:${EMAIL_COLORS.bandSubtitle};text-transform:uppercase;letter-spacing:0.6px;margin-top:2px;">[Puerto Nuevo]</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Línea de acento -->
            <tr>
              <td style="height:3px;line-height:3px;font-size:0;background:${EMAIL_COLORS.bandAccent};">&nbsp;</td>
            </tr>

            <!-- Cuerpo -->
            <tr>
              <td style="padding:32px 32px 24px 32px;">
                <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(title)}</h1>
                ${previewBlock}
                ${content}

                <!-- Footer -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;border-top:1px solid ${EMAIL_COLORS.bandAccent};">
                  <tr>
                    <td style="padding-top:12px;font-size:12px;color:${EMAIL_COLORS.muted};">
                      ${escapeHtml(t("emails.footer", {}, language))}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
};

// Fila etiqueta/valor de las tablas de datos. `strong` = valor en negritas.
const fieldRow = (label: string, value: string, { strong = false, first = false } = {}): string => `
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;${first ? "width:140px;" : ""}">${escapeHtml(label)}</td>
            <td style="padding:6px 0;${strong ? "font-weight:700;" : ""}color:${EMAIL_COLORS.ink};">${escapeHtml(value)}</td>
          </tr>`;

const fieldTable = (rows: string[], margin = "8px 0"): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${margin};">${rows.join("")}
        </table>`;

const paragraph = (html: string, margin = "0 0 12px 0"): string => `<p style="margin:${margin};">${html}</p>`;

const hint = (text: string, margin = "8px 0 0 0"): string =>
  `<p style="margin:${margin};font-size:13px;color:${EMAIL_COLORS.muted};">${escapeHtml(text)}</p>`;

const strong = (value: string): string => `<strong>${escapeHtml(value)}</strong>`;

interface EmailContent {
  subject: string;
  html: string;
}

const FIELD_KEYS = {
  authorizedBy: "emails.fields.authorizedBy",
  createdBy: "emails.fields.createdBy",
  date: "emails.fields.date",
  department: "emails.fields.department",
  document: "emails.fields.document",
  email: "emails.fields.email",
  employee: "emails.fields.employee",
  employeeNumber: "emails.fields.employeeNumber",
  jobTitle: "emails.fields.jobTitle",
  name: "emails.fields.name",
  registeredBy: "emails.fields.registeredBy",
  registrationDate: "emails.fields.registrationDate",
  role: "emails.fields.role",
  tempPassword: "emails.fields.tempPassword",
  type: "emails.fields.type",
  uploadedBy: "emails.fields.uploadedBy",
  username: "emails.fields.username",
} as const;

export interface WelcomeEmailInput {
  language: Language;
  to: string;
  name: string;
  username: string;
  tempPassword: string;
  /**
   * Versión detallada para admin/HR. Omite la contraseña temporal y agrega
   * metadata del empleado (rol, departamento, fecha de alta).
   */
  forAdmin?: boolean;
  /** Detalles opcionales para la versión admin (rol, departamento, fecha). */
  actorName?: string;
  role?: string;
  departmentName?: string;
  email?: string | null;
  registrationDate?: string;
}

export const welcomeEmail = (input: WelcomeEmailInput): EmailContent => {
  const { language: lng, name, username } = input;
  const f = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key], {}, lng);

  if (input.forAdmin) {
    const body = card({
      title: t("emails.welcomeAdmin.cardTitle", {}, lng),
      content: `
        ${fieldTable([
          fieldRow(f("name"), name, { strong: true, first: true }),
          fieldRow(f("username"), username),
          fieldRow(f("role"), input.role ?? "EMPLOYEE"),
          fieldRow(f("department"), input.departmentName ?? t("labels.unassigned", {}, lng)),
          fieldRow(f("email"), input.email ?? t("emails.welcomeAdmin.noEmail", {}, lng)),
          fieldRow(f("registrationDate"), input.registrationDate ?? formatDateTime(new Date(), lng)),
          fieldRow(f("createdBy"), input.actorName ?? t("labels.administrator", {}, lng)),
        ])}
        ${hint(t("emails.welcomeAdmin.hint", {}, lng))}
      `,
    });
    return {
      subject: t("emails.welcomeAdmin.subject", { name }, lng),
      html: layoutEmail({
        language: lng,
        title: t("emails.welcomeAdmin.title", {}, lng),
        preview: t("emails.welcomeAdmin.preview", { name }, lng),
        content: body,
      }),
    };
  }

  const body = card({
    title: t("emails.welcome.cardTitle", {}, lng),
    content: `
      ${paragraph(t("emails.welcome.body", { name: strong(name) }, lng))}
      ${fieldTable([
        fieldRow(f("username"), username, { strong: true, first: true }),
        fieldRow(f("tempPassword"), input.tempPassword, { strong: true }),
      ])}
      ${hint(t("emails.welcome.hint", {}, lng))}
    `,
  });
  return {
    subject: t("emails.welcome.subject", {}, lng),
    html: layoutEmail({
      language: lng,
      title: t("emails.welcome.title", {}, lng),
      preview: t("emails.welcome.preview", {}, lng),
      content: body,
    }),
  };
};

export interface DocumentUploadedEmailInput {
  language: Language;
  to: string;
  name: string;
  uploader: string;
  docName: string;
  /**
   * URL pública del documento (S3). Se muestra como enlace; el archivo viaja
   * además como adjunto cuando no excede el límite de tamaño.
   */
  docUrl?: string;
  /**
   * Versión detallada para admin/HR: incluye el tipo de documento y la fecha.
   */
  forAdmin?: boolean;
  typeName?: string;
  date?: string;
}

const docLinkBlock = (lng: Language, docUrl?: string): string =>
  docUrl
    ? `
        <p style="margin:14px 0 0 0;">
          <a href="${escapeHtml(docUrl)}" style="display:inline-block;background:${EMAIL_COLORS.band};color:${EMAIL_COLORS.white};font-size:13px;font-weight:700;text-decoration:none;border-radius:6px;padding:10px 16px;">${escapeHtml(t("emails.documentUploaded.download", {}, lng))}</a>
        </p>
        <p style="margin:6px 0 0 0;font-size:11px;color:${EMAIL_COLORS.muted};">${escapeHtml(t("emails.documentUploaded.downloadHint", {}, lng))}</p>`
    : "";

export const documentUploadedEmail = (input: DocumentUploadedEmailInput): EmailContent => {
  const { language: lng, name, uploader, docName } = input;
  const f = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key], {}, lng);

  if (input.forAdmin) {
    const body = card({
      title: t("emails.documentUploaded.cardTitle", {}, lng),
      content: `
        ${fieldTable([
          fieldRow(f("employee"), name, { strong: true, first: true }),
          fieldRow(f("document"), docName),
          fieldRow(f("type"), input.typeName ?? "—"),
          fieldRow(f("uploadedBy"), uploader),
          fieldRow(f("date"), input.date ?? formatDateTime(new Date(), lng)),
        ])}
        ${docLinkBlock(lng, input.docUrl)}
      `,
    });
    return {
      subject: t("emails.documentUploadedAdmin.subject", { uploader, document: docName, name }, lng),
      html: layoutEmail({
        language: lng,
        title: t("emails.documentUploadedAdmin.title", {}, lng),
        preview: t("emails.documentUploadedAdmin.preview", { document: docName, name }, lng),
        content: body,
      }),
    };
  }

  const body = card({
    title: t("emails.documentUploaded.cardTitle", {}, lng),
    content: `
      ${paragraph(t("emails.documentUploaded.body", { name: strong(name) }, lng))}
      ${fieldTable([
        fieldRow(f("document"), docName, { strong: true, first: true }),
        fieldRow(f("uploadedBy"), uploader),
      ])}
      ${docLinkBlock(lng, input.docUrl)}
      ${hint(t("emails.documentUploaded.hint", {}, lng))}
    `,
  });
  return {
    subject: t("emails.documentUploaded.subject", { document: docName }, lng),
    html: layoutEmail({
      language: lng,
      title: t("emails.documentUploaded.title", {}, lng),
      preview: t("emails.documentUploaded.preview", {}, lng),
      content: body,
    }),
  };
};

export interface UserDeactivatedEmailInput {
  language: Language;
  to: string;
  name: string;
  reason: string;
  date: string;
  byName: string;
  /**
   * Versión detallada para admin/HR. Cambia el subject y muestra tarjeta
   * de danger con metadata completa (empleado, rol, fecha, motivo).
   */
  forAdmin?: boolean;
  role?: string;
}

export const userDeactivatedEmail = (input: UserDeactivatedEmailInput): EmailContent => {
  const { language: lng, name, reason, date, byName } = input;
  const f = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key], {}, lng);

  const reasonCard = card({
    title: t("emails.deactivated.reasonTitle", {}, lng),
    variant: "danger",
    content: `<p style="margin:0;color:${EMAIL_COLORS.ink};">${escapeHtml(reason)}</p>`,
  });

  const variant = input.forAdmin ? "deactivatedAdmin" : "deactivated";
  const rows = input.forAdmin
    ? [
        fieldRow(f("employee"), name, { strong: true, first: true }),
        fieldRow(f("role"), input.role ?? "—"),
        fieldRow(f("authorizedBy"), byName),
        fieldRow(f("date"), date),
      ]
    : [fieldRow(f("authorizedBy"), byName, { first: true }), fieldRow(f("date"), date)];

  const metaCard = card({
    title: t("emails.deactivated.cardTitle", {}, lng),
    content: `
      ${fieldTable(rows, "4px 0")}
      ${hint(t(`emails.${variant}.hint`, {}, lng), "12px 0 0 0")}
    `,
  });

  return {
    subject: t(`emails.${variant}.subject`, { name, actor: byName }, lng),
    html: layoutEmail({
      language: lng,
      title: t(`emails.${variant}.title`, {}, lng),
      preview: t(`emails.${variant}.preview`, { name, actor: byName }, lng),
      content: reasonCard + metaCard,
    }),
  };
};

export interface UserReactivatedEmailInput {
  language: Language;
  to: string;
  name: string;
  date: string;
  byName: string;
  role?: string;
  /**
   * Versión de bitácora para NOTIFICATION_EMAILS. Cambia el subject y muestra
   * tarjeta de success con metadata completa (empleado, rol, autorizado por,
   * fecha).
   */
  forAdmin?: boolean;
}

export const userReactivatedEmail = (input: UserReactivatedEmailInput): EmailContent => {
  const { language: lng, name, date, byName } = input;
  const f = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key], {}, lng);

  const successCard = card({
    title: t("emails.reactivated.statusTitle", {}, lng),
    variant: "success",
    content: `<p style="margin:0;color:${EMAIL_COLORS.ink};">${t(
      "emails.reactivated.status",
      { active: strong(t("emails.reactivated.active", {}, lng)) },
      lng
    )}</p>`,
  });

  const variant = input.forAdmin ? "reactivatedAdmin" : "reactivated";
  const rows = input.forAdmin
    ? [
        fieldRow(f("employee"), name, { strong: true, first: true }),
        fieldRow(f("role"), input.role ?? "—"),
        fieldRow(f("authorizedBy"), byName),
        fieldRow(f("date"), date),
      ]
    : [fieldRow(f("authorizedBy"), byName, { first: true }), fieldRow(f("date"), date)];

  const metaCard = card({
    title: t("emails.reactivated.cardTitle", {}, lng),
    content: `
      ${fieldTable(rows, "4px 0")}
      ${hint(t(`emails.${variant}.hint`, {}, lng), "12px 0 0 0")}
    `,
  });

  return {
    subject: t(`emails.${variant}.subject`, { name, actor: byName }, lng),
    html: layoutEmail({
      language: lng,
      title: t(`emails.${variant}.title`, {}, lng),
      preview: t(`emails.${variant}.preview`, { name, actor: byName }, lng),
      content: successCard + metaCard,
    }),
  };
};

export interface EmployeeRegistrationEmailInput {
  language: Language;
  name: string;
  employeeNumber?: string | null;
  jobTitle?: string | null;
  departmentName?: string | null;
  email?: string | null;
  createdBy?: string;
  date?: string;
  /** Nombres de los documentos que van adjuntos. */
  documents: string[];
}

/**
 * Correo de "Alta de personal": se envía al dar de alta a un empleado, con su
 * INE y comprobante de domicilio adjuntos (por referencia S3).
 */
export const employeeRegistrationEmail = (input: EmployeeRegistrationEmailInput): EmailContent => {
  const lng = input.language;
  const f = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key], {}, lng);
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:150px;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(value)}</td>
    </tr>`;

  const docsList = input.documents.length
    ? input.documents.map((d) => `<li style="margin:3px 0;">${escapeHtml(d)}</li>`).join("")
    : `<li style="margin:3px 0;color:${EMAIL_COLORS.muted};">${escapeHtml(t("emails.employeeRegistration.noDocuments", {}, lng))}</li>`;

  const title = t("emails.employeeRegistration.title", {}, lng);
  const body = card({
    title,
    variant: "success",
    content: `
      ${paragraph(t("emails.employeeRegistration.body", { name: strong(input.name) }, lng))}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
        ${row(f("employee"), input.name)}
        ${input.employeeNumber ? row(f("employeeNumber"), input.employeeNumber) : ""}
        ${input.jobTitle ? row(f("jobTitle"), input.jobTitle) : ""}
        ${input.departmentName ? row(f("department"), input.departmentName) : ""}
        ${input.email ? row(f("email"), input.email) : ""}
        ${input.createdBy ? row(f("registeredBy"), input.createdBy) : ""}
        ${row(f("date"), input.date ?? formatDateTime(new Date(), lng))}
      </table>
      <p style="margin:14px 0 4px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(t("emails.employeeRegistration.documents", {}, lng))}</p>
      <ul style="margin:0;padding-left:18px;color:${EMAIL_COLORS.ink};font-size:13px;">${docsList}</ul>
    `,
  });

  return {
    subject: t("emails.employeeRegistration.subject", { name: input.name }, lng),
    html: layoutEmail({
      language: lng,
      title,
      preview: t("emails.employeeRegistration.preview", { name: input.name }, lng),
      content: body,
    }),
  };
};

// --- Tickets: avisos cortos (sin layout), con el contenido del usuario escapado.

export const ticketCreatedEmail = (
  lng: Language,
  ticket: { title: string; description: string }
): EmailContent => ({
  subject: t("emails.ticketCreated.subject", { title: ticket.title }, lng),
  html: `<p>${t("emails.ticketCreated.body", { title: strong(ticket.title) }, lng)}</p><p>${escapeHtml(ticket.description)}</p>`,
});

export const ticketCommentEmail = (
  lng: Language,
  input: { ticketTitle: string; author: string; text: string }
): EmailContent => ({
  subject: t("emails.ticketComment.subject", { title: input.ticketTitle }, lng),
  html: `<p>${t("emails.ticketComment.body", { author: strong(input.author), title: strong(input.ticketTitle) }, lng)}</p><p>${escapeHtml(input.text)}</p>`,
});

export const taskAssignedEmail = (
  lng: Language,
  input: { ticketTitle: string; taskTitle: string }
): EmailContent => ({
  subject: t("emails.taskAssigned.subject", { title: input.taskTitle }, lng),
  html: `<p>${t("emails.taskAssigned.body", { ticket: strong(input.ticketTitle) }, lng)}</p><p>${escapeHtml(input.taskTitle)}</p>`,
});
