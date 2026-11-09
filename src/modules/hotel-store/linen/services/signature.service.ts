import type { HotelSignatureMethod, HotelSignatureRole, Prisma, PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import { HttpError } from "@core/middlewares/error.middleware";
import { comparePassword } from "@core/utils/security";
import type { AuditLogger } from "@modules/users/services/user.service";
import { AttemptLimiter, COSIGN_TTL_SECONDS, signCosignToken, verifyCosignToken } from "./cosign-token";

/** Firmas de documentos de blancos (D5): quién, cuándo y cómo. */
export class HotelSignatureService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger,
    private readonly limiter: AttemptLimiter = new AttemptLimiter(),
    private readonly secret: string = env.JWT_SECRET
  ) {}

  /** Registra la firma de `userId`. Una firma por documento y rol (409 si ya existe). */
  async sign(
    docType: string,
    docId: string,
    role: HotelSignatureRole,
    userId: string,
    method: HotelSignatureMethod = "SESSION",
    tx?: Prisma.TransactionClient,
    notes?: string | null
  ) {
    const client = tx ?? this.db;
    try {
      return await client.hotelSignature.create({
        data: { docType, docId, role, userId, method, notes: notes ?? null },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") throw new HttpError(409, "HOTEL_SIGNATURE_DUPLICATE");
      throw err;
    }
  }

  /** Firma con el `cosignToken` de un tercero (método PASSWORD). */
  async signWithCosignToken(
    docType: string,
    docId: string,
    role: HotelSignatureRole,
    cosignToken: string,
    tx?: Prisma.TransactionClient,
    notes?: string | null
  ) {
    const userId = await this.resolveCosignUser(cosignToken);
    return this.sign(docType, docId, role, userId, "PASSWORD", tx, notes);
  }

  /** Usuario activo detrás de un cosignToken vigente. */
  async resolveCosignUser(cosignToken: string): Promise<string> {
    const userId = verifyCosignToken(cosignToken, this.secret);
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { id: true, active: true } });
    if (!user || !user.active) throw new HttpError(401, "HOTEL_COSIGN_TOKEN_INVALID");
    return user.id;
  }

  /**
   * Valida usuario y contraseña de un tercero (mismo bcrypt del login, cuenta activa) y
   * devuelve un token de 5 min. Rate-limit por usuario; cada intento queda auditado.
   */
  async cosign(username: string, password: string, actorId: string) {
    const key = username.toLowerCase();
    this.limiter.assertAllowed(key);

    const user = await this.db.user.findUnique({ where: { username } });
    const fail = async (code: "INVALID_CREDENTIALS" | "ACCOUNT_DEACTIVATED", status: number): Promise<never> => {
      this.limiter.recordFailure(key);
      await this.audit?.({
        action: "HOTEL_LINEN_COSIGN_FAILED",
        entityType: "User",
        entityId: user?.id ?? username,
        userId: actorId,
        metadata: { username, reason: code },
      });
      throw new HttpError(status, code);
    };

    if (!user) return fail("INVALID_CREDENTIALS", 401);
    if (!user.active) return fail("ACCOUNT_DEACTIVATED", 403);
    if (!(await comparePassword(password, user.password))) return fail("INVALID_CREDENTIALS", 401);

    this.limiter.reset(key);
    await this.audit?.({
      action: "HOTEL_LINEN_COSIGNED",
      entityType: "User",
      entityId: user.id,
      userId: actorId,
      metadata: { username: user.username },
    });
    return {
      cosignToken: signCosignToken(user.id, this.secret),
      expiresIn: COSIGN_TTL_SECONDS,
      user: { id: user.id, name: user.name, username: user.username },
    };
  }

  /** Firmas de un documento. */
  list(docType: string, docId: string) {
    return this.db.hotelSignature.findMany({
      where: { docType, docId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { signedAt: "asc" },
    });
  }
}
