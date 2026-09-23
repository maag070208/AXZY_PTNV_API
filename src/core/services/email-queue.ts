import type { EmailLog } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import { getNotificationRecipients, sendEmail, type EmailAttachment } from "@core/services/mail";
import { downloadObject } from "@core/services/storage";

/**
 * Cola desatendida de correo (outbox pattern) + bitácora de envíos.
 *
 * Los triggers de notificación NUNCA llaman a Resend/SMTP dentro del request:
 * solo INSERTAN una fila `PENDING` en `email_logs` (rápido, sin I/O de red).
 * Un worker en background (mismo proceso, ver `startEmailWorker`) drena la
 * cola con `sendEmail`, aplica reintentos con backoff exponencial y deja el
 * resultado en la fila (`SENT`/`FAILED`) — que además es el log consultable
 * por el ADMIN.
 *
 * Los adjuntos se guardan como referencia S3 `[{storageKey, originalName,
 * contentType}]` (el archivo ya está en S3 por el propio upload del documento);
 * el worker lo descarga justo antes de enviar.
 */

export interface QueuedAttachment {
  storageKey: string;
  originalName: string;
  contentType: string;
}

export interface EnqueueEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  /** Referencias S3 que el worker descarga al enviar. */
  attachments?: QueuedAttachment[];
  /** Clasificación del evento para trazabilidad/bitácora: "user.deactivate", etc. */
  action?: string;
  entityType?: string;
  entityId?: string;
}

const serializeTo = (to: string | string[]): string =>
  Array.isArray(to) ? to.join(", ") : to;

/**
 * Encola un correo: INSERT a `email_logs` (PENDING). Nunca lanza ante fallos
 * de BD (loguea y devuelve false) para que el request jamás se bloquee.
 */
export const enqueueEmail = async (input: EnqueueEmailInput): Promise<boolean> => {
  try {
    await prismaClient.emailLog.create({
      data: {
        to: serializeTo(input.to),
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.length ? (input.attachments as unknown as object) : undefined,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        status: "PENDING",
      },
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email-queue] enqueue failed:", err);
    return false;
  }
};

/**
 * Encola el correo de "registro" dirigido a los NOTIFICATION_EMAILS del
 * catálogo (`sys_config` → `EMAIL_NOTIFICATION_RECIPIENTS`, fallback env).
 * Los destinatarios se resuelven AHORA y quedan congelados en `to`: el worker
 * envía exactamente a esa lista (con `skipStakeholders: true`), sin re-resolver
 * el catálogo al momento del envío.
 */
export const enqueueNotificationEmail = async (
  input: Omit<EnqueueEmailInput, "to">
): Promise<boolean> => {
  const recipients = await getNotificationRecipients();
  if (recipients.length === 0) return true;
  return enqueueEmail({ ...input, to: recipients });
};

/**
 * Retry manual: reinicia el contador de intentos para que un reintento venga
 * con un ciclo completo de backoff. Lo usa el módulo admin (POST /mail/logs/:id/retry).
 */
export const retryEmail = async (id: string): Promise<EmailLog | null> => {
  const row = await prismaClient.emailLog.findUnique({ where: { id } });
  if (!row) return null;
  if (row.status === "SENT") return null;
  return prismaClient.emailLog.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() },
  });
};

const backoffMs = (attempts: number): number => {
  const base = env.EMAIL_QUEUE_RETRY_BASE_MS;
  // Exponencial con tope de 15 min para no acumular cola ante un SMTP caído.
  return Math.min(base * 2 ** (attempts - 1), 15 * 60 * 1000);
};

const loadAttachments = async (
  raw: EmailLog["attachments"]
): Promise<EmailAttachment[] | undefined> => {
  const list = (raw ?? []) as unknown as QueuedAttachment[];
  if (list.length === 0) return undefined;
  const out: EmailAttachment[] = [];
  for (const a of list) {
    let body: Buffer;
    try {
      body = await downloadObject(a.storageKey);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[email-queue] download attachment ${a.storageKey} failed:`, err);
      throw err;
    }
    out.push({ filename: a.originalName, content: body, contentType: a.contentType });
  }
  return out;
};

const runRow = async (row: EmailLog): Promise<void> => {
  const attempts = row.attempts + 1;

  try {
    const attachments = await loadAttachments(row.attachments);
    const ok = await sendEmail({
      to: row.to
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      subject: row.subject,
      html: row.html,
      attachments,
      skipStakeholders: true,
    });
    if (!ok) throw new Error("sendEmail devolvió false");

    await prismaClient.emailLog.update({
      where: { id: row.id },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    if (attempts >= env.EMAIL_QUEUE_MAX_ATTEMPTS) {
      await prismaClient.emailLog.update({
        where: { id: row.id },
        data: { status: "FAILED", attempts, lastError, nextAttemptAt: null },
      });
    } else {
      await prismaClient.emailLog.update({
        where: { id: row.id },
        data: { status: "PENDING", attempts, lastError, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
      });
    }
  }
};

/** Concurrency limitada sin dependencias (mini pool). */
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array(Math.min(limit, queue.length))
    .fill(0)
    .map(async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    });
  await Promise.all(workers);
}

const poll = async (): Promise<void> => {
  const rows = await prismaClient.emailLog.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: env.EMAIL_QUEUE_BATCH_SIZE,
  });
  if (rows.length === 0) return;
  await withConcurrency(rows, env.EMAIL_QUEUE_CONCURRENCY, runRow);
};

let workerTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

const tick = async (): Promise<void> => {
  // Un solo ciclo a la vez: las filas se reclaman dentro del poll; si el
  // batch anterior aún corre, este tick se descarta.
  if (draining) return;
  draining = true;
  try {
    await poll();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email-queue] poll error:", err);
  } finally {
    draining = false;
  }
};

/**
 * Arranca el worker en el proceso del API. Devuelve `stopEmailWorker`.
 * El primer drenado corre al boot (recupera PENDING de arranques previos).
 */
export const startEmailWorker = (): (() => void) => {
  if (workerTimer) return stopEmailWorker;
  void tick();
  workerTimer = setInterval(() => {
    void tick();
  }, env.EMAIL_QUEUE_POLL_MS);
  return stopEmailWorker;
};

export const stopEmailWorker = (): void => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
};