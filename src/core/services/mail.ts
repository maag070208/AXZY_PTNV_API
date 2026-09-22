import { Resend } from "resend";
import type * as nodemailer from "nodemailer";
import { env } from "@core/config/env.config";
import type { SysConfigService } from "@modules/config/services/sys-config.service";

/**
 * Email transport. Dual provider:
 *   1. Resend (primary) cuando `RESEND_API_KEY` está configurado.
 *   2. SMTP / nodemailer (fallback) cuando `SMTP_HOST/USER/PASS` están configurados.
 *
 * Mantiene la firma pública `sendEmail({ to, subject, html })` que ya consumen
 * los triggers (welcome, documentUploaded, userDeactivated). Si ninguno de los
 * dos proveedores está configurado, el envío entra en dry-run y se registra
 * en consola.
 *
 * Los destinatarios CC ("stakeholders") se leen desde la tabla `sys_config`
 * (clave `EMAIL_NOTIFICATION_RECIPIENTS`) con cache TTL=60s administrado por
 * `SysConfigService.get`. Fallback legacy: variable de entorno
 * `NOTIFICATION_EMAILS`. El boot del API inyecta el servicio vía
 * `setSysConfigService()`; si todavía no se inyectó (tests que importan
 * `mail.ts` directo, scripts, etc.), se usa el env como fallback.
 */

type Nodemailer = typeof import("nodemailer");

let resendClient: Resend | null = null;
let transporter: nodemailer.Transporter | null = null;
let nodemailerModule: Nodemailer | null = null;
let sysConfigServiceRef: SysConfigService | null = null;
let seededFromEnv = false;

export const setSysConfigService = (svc: SysConfigService): void => {
  sysConfigServiceRef = svc;
};

const getResend = (): Resend | null => {
  if (!env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
};

const isDryRun = (): boolean => {
  if (env.EMAIL_DRY_RUN === true) return true;
  // Dry-run si no hay ningún proveedor configurado.
  const hasResend = !!env.RESEND_API_KEY;
  const hasSmtp = !!env.SMTP_HOST && !!env.SMTP_USER && !!env.SMTP_PASS;
  return !hasResend && !hasSmtp;
};

const getTransporter = (): nodemailer.Transporter | null => {
  if (transporter) return transporter;
  if (isDryRun()) return null;
  // Import dinámico para evitar coste en arranque si no se usa.
  if (!nodemailerModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodemailerModule = require("nodemailer") as Nodemailer;
  }
  transporter = nodemailerModule.createTransport({
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT ?? 465,
    secure: env.SMTP_SECURE ?? (env.SMTP_PORT === 465),
    auth: {
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!,
    },
    connectionTimeout: env.SMTP_CONNECTION_TIMEOUT ?? 10_000,
  });
  return transporter;
};

const envFallbackRecipients = (): string[] =>
  env.NOTIFICATION_EMAILS
    ? env.NOTIFICATION_EMAILS.split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0)
    : [];

/**
 * Resuelve los destinatarios CC. Lee la fila de `sys_config` (cache TTL
 * 60s dentro de `SysConfigService.get`). Si la BD no tiene la fila y aún
 * no se intentó el seed inicial, copia el valor de `NOTIFICATION_EMAILS`
 * a la tabla — una sola vez por proceso. Si todo falla, fallback a env.
 */
const getNotificationRecipients = async (): Promise<string[]> => {
  if (!sysConfigServiceRef) {
    return envFallbackRecipients();
  }

  let row = await sysConfigServiceRef.get("EMAIL_NOTIFICATION_RECIPIENTS");

if (!row && !seededFromEnv) {
    const fromEnv = env.NOTIFICATION_EMAILS ?? "";
    if (fromEnv.length > 0) {
      try {
        await sysConfigServiceRef.seedFromValue(
          "EMAIL_NOTIFICATION_RECIPIENTS",
          fromEnv,
          "Destinatarios copias en notificaciones (seed inicial desde env)"
        );
        seededFromEnv = true;
        row = await sysConfigServiceRef.get("EMAIL_NOTIFICATION_RECIPIENTS");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[mail] failed to seed EMAIL_NOTIFICATION_RECIPIENTS from env:",
          err
        );
      }
    } else {
      // Marca como intentado aunque no haya valor para evitar reintentos.
      seededFromEnv = true;
    }
  }

  if (!row || row.value.trim().length === 0) {
    return envFallbackRecipients();
  }

  return row.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const sendEmail = async (input: {
  to: string | string[];
  subject: string;
  html: string;
  /**
   * Si es `true`, NO se une con `EMAIL_NOTIFICATION_RECIPIENTS` (sys_config
   * ni fallback de env). El destinatario es exactamente `input.to`. Se usa en
   * los triggers de admin/HR (alta, baja, documento) que ya iteran la lista
   * de admins internamente para mandar un correo por destinatario.
   */
  skipStakeholders?: boolean;
}): Promise<boolean> => {
  const initialRecipients = Array.isArray(input.to) ? input.to : [input.to];
  // Union con los destinatarios CC configurados en EMAIL_NOTIFICATION_RECIPIENTS
  // (sys_config) con fallback a NOTIFICATION_EMAILS del env. Se omiten cuando
  // `skipStakeholders` es true (triggers que ya envían individualmente a cada
  // admin/HR). Mantenido como `to` (no bcc) porque los triggers los tratan
  // como destinatarios primarios. Dedupe vía Set para que un address que ya
  // aparezca en `input.to` no llegue dos veces.
  const stakeholders = input.skipStakeholders ? [] : await getNotificationRecipients();
  const recipients = [...new Set([...initialRecipients, ...stakeholders])];

  const dryRun = env.EMAIL_DRY_RUN === true;
  const resend = getResend();
  const tx = !dryRun && !resend ? getTransporter() : null;

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.info(
      `[mail:dry-run] to=${recipients.join(",")} subject="${input.subject}"`
    );
    return true;
  }

  if (resend) {
    try {
      const fromAddr =
        env.RESEND_FROM_EMAIL ?? env.SMTP_FROM ?? env.SMTP_USER ?? "noreply@axzy.dev";
      // Resend espera un header "From" con formato "Nombre <correo@dominio>".
      const fromHeader = fromAddr.includes("<") ? fromAddr : `Puerto Nuevo <${fromAddr}>`;
      const { error } = await resend.emails.send({
        from: fromHeader,
        to: recipients,
        subject: input.subject,
        html: input.html,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[mail:resend] error:", error);
        // Si no hay SMTP fallback configurado, falla definitivamente.
        if (!tx) return false;
      } else {
        // eslint-disable-next-line no-console
        console.info(`[mail:resend] sent to=${recipients.join(",")}`);
        return true;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[mail:resend] exception:", err);
      if (!tx) return false;
    }
  }

  if (tx) {
    try {
      await tx.sendMail({
        from: env.SMTP_FROM ?? env.SMTP_USER!,
        to: recipients.join(", "),
        subject: input.subject,
        html: input.html,
      });
      // eslint-disable-next-line no-console
      console.info(`[mail:smtp] sent to=${recipients.join(",")}`);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[mail:smtp] send failed:", err);
      return false;
    }
  }

  return false;
};