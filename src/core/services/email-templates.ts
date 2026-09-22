/**
 * Plantillas de email en español. Texto plano HTML, con escape de variables
 * dinámicas para evitar XSS por contenido controlado por el usuario.
 *
 * Diseño alineado con `web/src/shared/pdf/theme.ts#PDF_COLORS` (banda azul
 * `#0a4560`, acento `#5fb8dd`, cards con borde superior). Outlook-safe:
 * solo `<table>`/`<tr>`/`<td>` con estilos inline — nada de flex/grid.
 */

import { LOGO_PUERTO_NUEVO_BASE64 } from "@core/assets/logoPuertoNuevo";

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
  title: string;
  preview?: string;
  content: string;
}

const layoutEmail = ({ title, preview, content }: LayoutInput): string => {
  const previewBlock = preview
    ? `<p style="margin:0 0 16px 0;font-size:14px;color:${EMAIL_COLORS.muted};">${escapeHtml(preview)}</p>`
    : "";
  return `
<!doctype html>
<html lang="es">
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
                      <img src="${LOGO_PUERTO_NUEVO_BASE64}" alt="Puerto Nuevo" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:50%;background:${EMAIL_COLORS.white};border:0;outline:none;text-decoration:none;"/>
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
                      Mensaje automático del sistema · Puerto Nuevo Hotel y Villas
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

export interface WelcomeEmailInput {
  to: string;
  name: string;
  username: string;
  tempPassword: string;
}

export const welcomeEmail = ({ name, username, tempPassword }: WelcomeEmailInput): { subject: string; html: string } => {
  const subject = "[Puerto Nuevo] Bienvenido al sistema de Cartas Responsivas";
  const body = card({
    title: "Credenciales de acceso",
    content: `
      <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(name)}</strong>, se creó tu cuenta en el sistema de Cartas Responsivas de Puerto Nuevo.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Usuario</td>
          <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(username)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Contraseña temporal</td>
          <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(tempPassword)}</td>
        </tr>
      </table>
      <p style="margin:8px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Te recomendamos cambiar tu contraseña la primera vez que ingreses.</p>
    `,
  });
  return {
    subject,
    html: layoutEmail({
      title: "Bienvenido al sistema",
      preview: "Tu cuenta en el sistema de Cartas Responsivas está lista.",
      content: body,
    }),
  };
};

export interface DocumentUploadedEmailInput {
  to: string;
  name: string;
  uploader: string;
  docName: string;
}

export const documentUploadedEmail = ({ name, uploader, docName }: DocumentUploadedEmailInput): { subject: string; html: string } => {
  const subject = `[Puerto Nuevo] Documento cargado: ${docName}`;
  const body = card({
    title: "Detalle del documento",
    content: `
      <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(name)}</strong>, se cargó un nuevo documento a tu expediente personal.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Documento</td>
          <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(docName)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Cargado por</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(uploader)}</td>
        </tr>
      </table>
      <p style="margin:8px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Si no reconoces este documento, contacta al administrador.</p>
    `,
  });
  return {
    subject,
    html: layoutEmail({
      title: "Documento cargado",
      preview: "Nuevo documento en el expediente personal.",
      content: body,
    }),
  };
};

export interface UserDeactivatedEmailInput {
  to: string;
  name: string;
  motivo: string;
  fecha: string;
  byName: string;
}

export const userDeactivatedEmail = ({ name, motivo, fecha, byName }: UserDeactivatedEmailInput): { subject: string; html: string } => {
  const subject = `[Puerto Nuevo] Aviso de baja: ${name}`;
  const motivoCard = card({
    title: "Motivo de la baja",
    variant: "danger",
    content: `<p style="margin:0;color:${EMAIL_COLORS.ink};">${escapeHtml(motivo)}</p>`,
  });
  const metaCard = card({
    title: "Datos de la baja",
    content: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0;">
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Autorizado por</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(byName)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Fecha</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(fecha)}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Si consideras que se trata de un error, contacta al administrador para reactivar tu cuenta.</p>
    `,
  });
  return {
    subject,
    html: layoutEmail({
      title: "Tu cuenta fue dada de baja",
      preview: `Hola ${name}, te informamos sobre la baja de tu cuenta.`,
      content: motivoCard + metaCard,
    }),
  };
};