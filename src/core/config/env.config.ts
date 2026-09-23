import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const required = ["DATABASE_URL", "PORT", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: parseInt(process.env.PORT ?? "4001", 10),
  DATABASE_URL: process.env.DATABASE_URL!,
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "*",
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  INITIAL_ADMIN_USERNAME: process.env.INITIAL_ADMIN_USERNAME ?? "admin",
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD ?? "admin123",
  ABLY_API_KEY: process.env.ABLY_API_KEY!,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
  AWS_REGION: process.env.AWS_REGION ?? "us-east-2",
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  NOTIFICATION_EMAILS: process.env.NOTIFICATION_EMAILS ?? "",
  UPLOAD_MAX_BYTES: parseInt(process.env.UPLOAD_MAX_BYTES ?? "52428800", 10),
  // Máximo de adjunto que se incluye en los correos de "documento cargado"
  // (Resend limita a 40MB post-base64 por email). Archivos más grandes se
  // envían solo con el enlace en el cuerpo.
  EMAIL_ATTACH_MAX_BYTES: parseInt(process.env.EMAIL_ATTACH_MAX_BYTES ?? "20971520", 10),

  // Cola desatendida de correo (email_logs + worker en background). Intervalo
  // de poll, tamaño de batch por tick, envíos concurrentes por ciclo, intentos
  // máximos por correo y base de backoff exponencial (tope 15 min).
  EMAIL_QUEUE_POLL_MS: parseInt(process.env.EMAIL_QUEUE_POLL_MS ?? "2000", 10),
  EMAIL_QUEUE_BATCH_SIZE: parseInt(process.env.EMAIL_QUEUE_BATCH_SIZE ?? "10", 10),
  EMAIL_QUEUE_CONCURRENCY: parseInt(process.env.EMAIL_QUEUE_CONCURRENCY ?? "5", 10),
  EMAIL_QUEUE_MAX_ATTEMPTS: parseInt(process.env.EMAIL_QUEUE_MAX_ATTEMPTS ?? "5", 10),
  EMAIL_QUEUE_RETRY_BASE_MS: parseInt(process.env.EMAIL_QUEUE_RETRY_BASE_MS ?? "1000", 10),

  // SMTP (nodemailer). Si no se configuran, el mail entra en dry-run.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_CONNECTION_TIMEOUT: process.env.SMTP_CONNECTION_TIMEOUT
    ? parseInt(process.env.SMTP_CONNECTION_TIMEOUT, 10)
    : undefined,
  SMTP_FROM: process.env.SMTP_FROM,
  EMAIL_DRY_RUN:
    process.env.EMAIL_DRY_RUN === "true" ||
    (process.env.NODE_ENV !== "production" &&
      !process.env.SMTP_HOST &&
      !process.env.RESEND_API_KEY),
};
