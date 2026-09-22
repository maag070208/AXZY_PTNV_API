/**
 * Plantillas de email en español. Texto plano HTML, con escape de variables
 * dinámicas para evitar XSS por contenido controlado por el usuario.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const layout = (title: string, body: string): string => `
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(15,23,42,0.06);">
            <tr>
              <td>
                <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${escapeHtml(title)}</h1>
                ${body}
                <p style="margin-top:24px;font-size:12px;color:#64748b;">Este mensaje fue enviado automáticamente. Si tienes dudas, contacta al administrador del sistema.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

export interface WelcomeEmailInput {
  to: string;
  name: string;
  username: string;
  tempPassword: string;
}

export const welcomeEmail = ({ name, username, tempPassword }: WelcomeEmailInput): { subject: string; html: string } => {
  const subject = "Bienvenido al sistema de Cartas Responsivas";
  const html = layout(
    subject,
    `
      <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
      <p>Se creó tu cuenta en el sistema de Cartas Responsivas de Puerto Nuevo. Ya puedes iniciar sesión con las siguientes credenciales:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Usuario</td><td style="padding:4px 0;font-weight:700;">${escapeHtml(username)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Contraseña temporal</td><td style="padding:4px 0;font-weight:700;">${escapeHtml(tempPassword)}</td></tr>
      </table>
      <p>Te recomendamos cambiar tu contraseña la primera vez que ingreses.</p>
      <p style="margin-top:24px;">Saludos,<br/>Equipo de Cartas Responsivas</p>
    `
  );
  return { subject, html };
};

export interface DocumentUploadedEmailInput {
  to: string;
  name: string;
  uploader: string;
  docName: string;
}

export const documentUploadedEmail = ({ name, uploader, docName }: DocumentUploadedEmailInput): { subject: string; html: string } => {
  const subject = `Nuevo documento cargado en tu expediente: ${docName}`;
  const html = layout(
    "Documento cargado",
    `
      <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
      <p>Se cargó un nuevo documento a tu expediente personal.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Documento</td><td style="padding:4px 0;font-weight:700;">${escapeHtml(docName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Cargado por</td><td style="padding:4px 0;">${escapeHtml(uploader)}</td></tr>
      </table>
      <p>Si no reconoces este documento, contacta al administrador.</p>
    `
  );
  return { subject, html };
};

export interface UserDeactivatedEmailInput {
  to: string;
  name: string;
  motivo: string;
  fecha: string;
  byName: string;
}

export const userDeactivatedEmail = ({ name, motivo, fecha, byName }: UserDeactivatedEmailInput): { subject: string; html: string } => {
  const subject = "Tu cuenta fue dada de baja";
  const html = layout(
    "Tu cuenta fue dada de baja",
    `
      <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
      <p>Te informamos que tu cuenta en el sistema de Cartas Responsivas fue dada de baja.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Motivo</td><td style="padding:4px 0;">${escapeHtml(motivo)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Fecha</td><td style="padding:4px 0;">${escapeHtml(fecha)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">Autorizado por</td><td style="padding:4px 0;">${escapeHtml(byName)}</td></tr>
      </table>
      <p>Si consideras que se trata de un error, contacta al administrador para reactivar tu cuenta.</p>
    `
  );
  return { subject, html };
};
