import { Resend } from "resend";
import { env } from "@core/config/env.config";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export const sendEmail = async (input: {
  to: string | string[];
  subject: string;
  html: string;
}) => {
  if (!resend || !env.RESEND_FROM_EMAIL) return false;
  const fixedRecipients = env.NOTIFICATION_EMAILS
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const recipients = [...new Set([
    ...(Array.isArray(input.to) ? input.to : [input.to]),
    ...fixedRecipients,
  ])];
  const result = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: recipients,
    subject: input.subject,
    html: input.html,
  });
  if (result.error) throw new Error(result.error.message);
  return true;
};
