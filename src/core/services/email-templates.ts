/**
 * Plantillas de email en español. Texto plano HTML, con escape de variables
 * dinámicas para evitar XSS por contenido controlado por el usuario.
 *
 * Diseño alineado con `web/src/shared/pdf/theme.ts#PDF_COLORS` (banda azul
 * `#0a4560`, acento `#5fb8dd`, cards con borde superior). Outlook-safe:
 * solo `<table>`/`<tr>`/`<td>` con estilos inline — nada de flex/grid.
 */

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
  fechaAlta?: string;
}

export const welcomeEmail = (input: WelcomeEmailInput): { subject: string; html: string } => {
  const forAdmin = input.forAdmin ?? false;
  const { name, username } = input;
  const subject = forAdmin
    ? `[Puerto Nuevo] Nuevo empleado: ${name}`
    : "[Puerto Nuevo] Bienvenido al sistema de Cartas Responsivas";

  let body: string;
  let title: string;
  let preview: string;

  if (forAdmin) {
    title = "Nuevo empleado dado de alta";
    preview = `${name} fue dado de alta en el sistema.`;
    const rol = input.role ?? "EMPLEADO";
    const departamento = input.departmentName ?? "Sin asignar";
    const correo = input.email ?? "sin email";
    const fecha = input.fechaAlta ?? new Date().toLocaleString("es-MX");
    const actor = input.actorName ?? "Administrador";
    body = card({
      title: "Datos del empleado",
      content: `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Nombre</td>
            <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Usuario</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(username)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Rol</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(rol)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Departamento</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(departamento)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Correo</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(correo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Fecha de alta</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(fecha)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Creado por</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(actor)}</td>
          </tr>
        </table>
        <p style="margin:8px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Este es un aviso automático. Las credenciales se enviaron al empleado por separado.</p>
      `,
    });
  } else {
    title = "Bienvenido al sistema";
    preview = "Tu cuenta en el sistema de Cartas Responsivas está lista.";
    body = card({
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
            <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(input.tempPassword)}</td>
          </tr>
        </table>
        <p style="margin:8px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Te recomendamos cambiar tu contraseña la primera vez que ingreses.</p>
      `,
    });
  }

  return {
    subject,
    html: layoutEmail({ title, preview, content: body }),
  };
};

export interface DocumentUploadedEmailInput {
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
  tipoNombre?: string;
  fecha?: string;
}

const docLinkBlock = (docUrl?: string): string =>
  docUrl
    ? `
        <p style="margin:14px 0 0 0;">
          <a href="${escapeHtml(docUrl)}" style="display:inline-block;background:${EMAIL_COLORS.band};color:${EMAIL_COLORS.white};font-size:13px;font-weight:700;text-decoration:none;border-radius:6px;padding:10px 16px;">Descargar documento</a>
        </p>
        <p style="margin:6px 0 0 0;font-size:11px;color:${EMAIL_COLORS.muted};">Si no puedes descargarlo, revisa las notificaciones del sistema o contacta a administración.</p>`
    : "";

export const documentUploadedEmail = (input: DocumentUploadedEmailInput): { subject: string; html: string } => {
  const forAdmin = input.forAdmin ?? false;
  const { name, uploader, docName } = input;
  const subject = forAdmin
    ? `[Puerto Nuevo] ${uploader} cargó ${docName} al expediente de ${name}`
    : `[Puerto Nuevo] Documento cargado a tu expediente: ${docName}`;

  let body: string;
  let title: string;
  let preview: string;

  if (forAdmin) {
    const tipo = input.tipoNombre ?? "—";
    const fecha = input.fecha ?? new Date().toLocaleString("es-MX");
    title = "Documento cargado al expediente";
    preview = `${docName} se cargó al expediente de ${name}.`;
    body = card({
      title: "Detalle del documento",
      content: `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Empleado</td>
            <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Documento</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(docName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Tipo</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(tipo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Cargado por</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(uploader)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Fecha</td>
            <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(fecha)}</td>
          </tr>
        </table>
        ${docLinkBlock(input.docUrl)}
      `,
    });
  } else {
    title = "Documento cargado";
    preview = "Nuevo documento en el expediente personal.";
    body = card({
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
        ${docLinkBlock(input.docUrl)}
        <p style="margin:8px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Si no reconoces este documento, contacta al administrador.</p>
      `,
    });
  }

  return {
    subject,
    html: layoutEmail({ title, preview, content: body }),
  };
};

export interface UserDeactivatedEmailInput {
  to: string;
  name: string;
  motivo: string;
  fecha: string;
  byName: string;
  /**
   * Versión detallada para admin/HR. Cambia el subject y muestra tarjeta
   * de danger con metadata completa (empleado, rol, fecha, motivo).
   */
  forAdmin?: boolean;
  role?: string;
}

export const userDeactivatedEmail = (input: UserDeactivatedEmailInput): { subject: string; html: string } => {
  const forAdmin = input.forAdmin ?? false;
  const { name, motivo, fecha, byName } = input;
  const subject = forAdmin
    ? `[Puerto Nuevo] ${name} fue dado de baja por ${byName}`
    : "[Puerto Nuevo] Tu cuenta fue dada de baja";

  const motivoCard = card({
    title: "Motivo de la baja",
    variant: "danger",
    content: `<p style="margin:0;color:${EMAIL_COLORS.ink};">${escapeHtml(motivo)}</p>`,
  });

  let metaCardContent: string;
  let title: string;
  let preview: string;

  if (forAdmin) {
    const rol = input.role ?? "—";
    title = "Baja de empleado";
    preview = `${name} fue dado de baja por ${byName}.`;
    metaCardContent = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0;">
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Empleado</td>
          <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Rol</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(rol)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Autorizado por</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(byName)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Fecha</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(fecha)}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Este es un aviso automático. La baja ya quedó registrada en el sistema.</p>
    `;
  } else {
    title = "Tu cuenta fue dada de baja";
    preview = `Hola ${name}, te informamos sobre la baja de tu cuenta.`;
    metaCardContent = `
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
    `;
  }

  const metaCard = card({
    title: "Datos de la baja",
    content: metaCardContent,
  });

  return {
    subject,
    html: layoutEmail({ title, preview, content: motivoCard + metaCard }),
  };
};

export interface UserReactivatedEmailInput {
  to: string;
  name: string;
  fecha: string;
  byName: string;
  role?: string;
  /**
   * Versión de bitácora para NOTIFICATION_EMAILS. Cambia el subject y muestra
   * tarjeta de success con metadata completa (empleado, rol, autorizado por,
   * fecha).
   */
  forAdmin?: boolean;
}

export const userReactivatedEmail = (input: UserReactivatedEmailInput): { subject: string; html: string } => {
  const forAdmin = input.forAdmin ?? false;
  const { name, fecha, byName } = input;
  const subject = forAdmin
    ? `[Puerto Nuevo] ${name} fue reactivado por ${byName}`
    : "[Puerto Nuevo] Tu cuenta fue reactivada";

  const successCard = card({
    title: "Estado de la cuenta",
    variant: "success",
    content: `<p style="margin:0;color:${EMAIL_COLORS.ink};">Tu cuenta quedó <strong>activa</strong> de nuevo y puedes ingresar al sistema.</p>`,
  });

  let metaCardContent: string;
  let title: string;
  let preview: string;

  if (forAdmin) {
    const rol = input.role ?? "—";
    title = "Reactivación de empleado";
    preview = `${name} fue reactivado por ${byName}.`;
    metaCardContent = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0;">
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:140px;">Empleado</td>
          <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Rol</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(rol)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Autorizado por</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(byName)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;">Fecha</td>
          <td style="padding:6px 0;color:${EMAIL_COLORS.ink};">${escapeHtml(fecha)}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Este es un aviso automático. La reactivación ya quedó registrada en el sistema.</p>
    `;
  } else {
    title = "Tu cuenta fue reactivada";
    preview = `Hola ${name}, tu cuenta está activa de nuevo.`;
    metaCardContent = `
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
      <p style="margin:12px 0 0 0;font-size:13px;color:${EMAIL_COLORS.muted};">Si no reconoces esta acción, contacta al administrador.</p>
    `;
  }

  const metaCard = card({
    title: "Datos de la reactivación",
    content: metaCardContent,
  });

  return {
    subject,
    html: layoutEmail({ title, preview, content: successCard + metaCard }),
  };
};
export interface EmployeeAltaEmailInput {
  name: string;
  numeroEmpleado?: string | null;
  puesto?: string | null;
  departmentName?: string | null;
  email?: string | null;
  createdBy?: string;
  fecha?: string;
  /** Nombres de los documentos que van adjuntos. */
  documentos: string[];
}

/**
 * Correo de "Alta de personal": se envía al dar de alta a un empleado, con su
 * INE y comprobante de domicilio adjuntos (por referencia S3).
 */
export const employeeAltaEmail = (input: EmployeeAltaEmailInput): { subject: string; html: string } => {
  const fecha = input.fecha ?? new Date().toLocaleString("es-MX");
  const subject = `[Puerto Nuevo] Alta de personal: ${input.name}`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:${EMAIL_COLORS.muted};font-size:12px;width:150px;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-weight:700;color:${EMAIL_COLORS.ink};">${escapeHtml(value)}</td>
    </tr>`;

  const docsList = input.documentos.length
    ? input.documentos.map((d) => `<li style="margin:3px 0;">${escapeHtml(d)}</li>`).join("")
    : `<li style="margin:3px 0;color:${EMAIL_COLORS.muted};">Sin documentos adjuntos</li>`;

  const body = card({
    title: "Alta de personal",
    variant: "success",
    content: `
      <p style="margin:0 0 12px 0;">Se dio de alta a <strong>${escapeHtml(input.name)}</strong> en el sistema.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0;">
        ${row("Empleado", input.name)}
        ${input.numeroEmpleado ? row("Nº de empleado", input.numeroEmpleado) : ""}
        ${input.puesto ? row("Puesto", input.puesto) : ""}
        ${input.departmentName ? row("Departamento", input.departmentName) : ""}
        ${input.email ? row("Correo", input.email) : ""}
        ${input.createdBy ? row("Alta por", input.createdBy) : ""}
        ${row("Fecha", fecha)}
      </table>
      <p style="margin:14px 0 4px 0;font-weight:700;color:${EMAIL_COLORS.ink};">Documentación adjunta</p>
      <ul style="margin:0;padding-left:18px;color:${EMAIL_COLORS.ink};font-size:13px;">${docsList}</ul>
    `,
  });

  return {
    subject,
    html: layoutEmail({ title: "Alta de personal", preview: `${input.name} fue dado de alta.`, content: body }),
  };
};
