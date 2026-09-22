import { Resend } from "resend";
import type * as nodemailer from "nodemailer";
import { env } from "@core/config/env.config";

/**
 * Email transport. Dual provider:
 *   1. Resend (primary) cuando `RESEND_API_KEY` está configurado.
 *   2. SMTP / nodemailer (fallback) cuando `SMTP_HOST/USER/PASS` están configurados.
 *
 * Mantiene la firma pública `sendEmail({ to, subject, html })` que ya consumen
 * los triggers (welcome, documentUploaded, userDeactivated). Si ninguno de los
 * dos proveedores está configurado, el envío entra en dry-run y se registra
 * en consola.
 */

type Nodemailer = typeof import("nodemailer");

let resendClient: Resend | null = null;
let transporter: nodemailer.Transporter | null = null;
let nodemailerModule: Nodemailer | null = null;

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