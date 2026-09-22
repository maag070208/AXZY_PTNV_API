import type * as nodemailer from "nodemailer";
import { env } from "@core/config/env.config";

/**
 * Email transport. SMTP (nodemailer) según configuración del .env.
 *
 * Mantiene la firma pública `sendEmail({ to, subject, html })` que ya consumen
 * los triggers (welcome, documentUploaded, userDeactivated). Si `EMAIL_DRY_RUN`
 * está activo (o no hay SMTP configurado), se omite el envío real y se
 * registra en consola.
 */

type Nodemailer = typeof import("nodemailer");

let transporter: nodemailer.Transporter | null = null;
let nodemailerModule: Nodemailer | null = null;

const isDryRun = (): boolean => {
  if (env.EMAIL_DRY_RUN) return true;
  // Sin credenciales SMTP, no hay transporte posible.
  return !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS;
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
    tls: env.SMTP_TLS_CIPHERS ? { ciphers: env.SMTP_TLS_CIPHERS } : undefined,
    connectionTimeout: env.SMTP_CONNECTION_TIMEOUT ?? 10_000,
  });
  return transporter;
};

export const sendEmail = async (input: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<boolean> => {
  const initialRecipients = Array.isArray(input.to) ? input.to : [input.to];
  // Union with the stakeholders configured in NOTIFICATION_EMAILS (comma-separated).
  // Kept as `to` (not bcc) because the triggers treat them as primary recipients.
  // Dedupe via Set so the same address doesn't receive the message twice if it
  // already appears in `input.to`.
  const stakeholders = env.NOTIFICATION_EMAILS
    ? env.NOTIFICATION_EMAILS.split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0)
    : [];
  const recipients = [...new Set([...initialRecipients, ...stakeholders])];

  if (isDryRun()) {
    // eslint-disable-next-line no-console
    console.info(
      `[mail:dry-run] to=${recipients.join(",")} subject="${input.subject}"`
    );
    return true;
  }

  const tx = getTransporter();
  if (!tx) return false;
  try {
    await tx.sendMail({
      from: env.SMTP_FROM ?? env.SMTP_USER!,
      to: recipients.join(", "),
      subject: input.subject,
      html: input.html,
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mail] send failed:", err);
    return false;
  }
};
