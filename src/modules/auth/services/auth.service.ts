import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import {
  comparePassword,
  hashPassword,
  signToken,
  signRefreshToken,
  verifyRefreshToken,
  type JwtPayload,
} from "@core/utils/security";
import { systemLanguage } from "@core/i18n";
import { HttpError } from "@core/middlewares/error.middleware";
import { userToEntity, entityToAuthUserDto, userToAuthMeDto } from "../mappers/auth.mapper";
import type { AuthMe, LoginResponse } from "../models/dto/auth.dto";

export class AuthService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.db.user.findUnique({
      where: { username },
      include: { extraRoles: { select: { role: true } } },
    });
    if (!user) throw new HttpError(401, "INVALID_CREDENTIALS");
    if (!user.active) {
      // Cuenta dada de baja. Separamos este caso del "credenciales inválidas"
      // para que la UI muestre el motivo en vez de un error genérico.
      const reason = user.deactivationReason ?? null;
      throw new HttpError(403, "ACCOUNT_DEACTIVATED", {}, reason ? { reason } : undefined);
    }

    const ok = await comparePassword(password, user.password);
    if (!ok) throw new HttpError(401, "INVALID_CREDENTIALS");

    const entity = userToEntity(user);
    const payload: JwtPayload = {
      id: entity.id,
      username: entity.username,
      role: entity.role,
      roles: entity.roles,
      departmentId: entity.departmentId,
    };
    const token = signToken(payload);

    return {
      token,
      refreshToken: signRefreshToken({ id: entity.id, username: entity.username }),
      user: entityToAuthUserDto(entity),
    };
  }

  /** Renueva el access token a partir de un refresh token vigente. */
  async refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, "INVALID_REFRESH_TOKEN");
    }
    const user = await this.db.user.findUnique({
      where: { id: payload.id },
      include: { extraRoles: { select: { role: true } } },
    });
    if (!user || !user.active) throw new HttpError(401, "INVALID_SESSION");

    const entity = userToEntity(user);
    const accessPayload: JwtPayload = {
      id: entity.id,
      username: entity.username,
      role: entity.role,
      roles: entity.roles,
      departmentId: entity.departmentId,
    };
    return {
      token: signToken(accessPayload),
      // Rotación: cada refresh entrega uno nuevo.
      refreshToken: signRefreshToken({ id: entity.id, username: entity.username }),
    };
  }

  /**
   * Cambia la propia contraseña. Con una contraseña provisional
   * (`mustChangePassword`) la web no deja seguir hasta hacerlo.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, password: true },
    });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND");

    const ok = await comparePassword(currentPassword, user.password);
    if (!ok) throw new HttpError(400, "INVALID_PASSWORD");
    if (newPassword === currentPassword) throw new HttpError(400, "PASSWORD_UNCHANGED");

    await this.db.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(newPassword), mustChangePassword: false },
    });
    await this.db.auditLog.create({
      data: {
        action: "USER_PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id,
        userId: user.id,
        userName: user.username,
        newState: { mustChangePassword: false },
        metadata: { origen: "cambio obligatorio" },
      },
    });
  }

  async me(userId: string): Promise<AuthMe> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        department: { select: { id: true, name: true } },
        extraRoles: { select: { role: true } },
        permissionGrants: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { permission: true, scope: true, expiresAt: true },
        },
      },
    });
    if (!user || !user.active) throw new HttpError(404, "USER_NOT_FOUND");
    return userToAuthMeDto(user, await systemLanguage());
  }
}