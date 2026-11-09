import jwt from "jsonwebtoken";
import { HttpError } from "@core/middlewares/error.middleware";

/**
 * Cosign token (D5): prueba de corta vida de que un tercero validó su usuario y
 * contraseña. Otros endpoints lo aceptan para registrar la firma de esa persona.
 * Funciones puras: el secreto se recibe como parámetro.
 */

export const COSIGN_PURPOSE = "linen-cosign";
/** Vida del token en segundos (5 min). */
export const COSIGN_TTL_SECONDS = 300;

export interface CosignPayload {
  userId: string;
  purpose: typeof COSIGN_PURPOSE;
}

export const signCosignToken = (userId: string, secret: string, ttlSeconds: number = COSIGN_TTL_SECONDS): string =>
  jwt.sign({ userId, purpose: COSIGN_PURPOSE } satisfies CosignPayload, secret, { expiresIn: ttlSeconds });

/** Devuelve el usuario que firmó; 401 si el token es inválido, está vencido o es de otro propósito. */
export const verifyCosignToken = (token: string, secret: string): string => {
  let payload: Partial<CosignPayload>;
  try {
    payload = jwt.verify(token, secret) as Partial<CosignPayload>;
  } catch {
    throw new HttpError(401, "HOTEL_COSIGN_TOKEN_INVALID");
  }
  if (payload.purpose !== COSIGN_PURPOSE || typeof payload.userId !== "string" || !payload.userId) {
    throw new HttpError(401, "HOTEL_COSIGN_TOKEN_INVALID");
  }
  return payload.userId;
};

/** Límite simple en memoria: máximo de fallos por usuario dentro de una ventana. */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number = 5,
    private readonly windowMs: number = 10 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length > 0) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** 429 si el usuario agotó sus intentos fallidos en la ventana. */
  assertAllowed(key: string): void {
    if (this.recent(key).length >= this.maxFailures) throw new HttpError(429, "HOTEL_COSIGN_RATE_LIMITED");
  }

  recordFailure(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
