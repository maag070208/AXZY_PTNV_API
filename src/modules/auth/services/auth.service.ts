import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import {
  comparePassword,
  signToken,
  type JwtPayload,
} from "@core/utils/security";
import { HttpError } from "@core/middlewares/error.middleware";
import { userToEntity, entityToAuthUserDto } from "../mappers/auth.mapper";
import type { AuthUser, LoginResponse } from "../models/dto/auth.dto";

export class AuthService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.db.user.findUnique({ where: { username } });
    if (!user || !user.active) throw new HttpError(401, "Credenciales inválidas");

    const ok = await comparePassword(password, user.password);
    if (!ok) throw new HttpError(401, "Credenciales inválidas");

    const entity = userToEntity(user);
    const payload: JwtPayload = {
      id: entity.id,
      username: entity.username,
      role: entity.role,
      departmentId: entity.departmentId,
    };
    const token = signToken(payload);

    return {
      token,
      user: entityToAuthUserDto(entity),
    };
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new HttpError(404, "Usuario no encontrado");
    return entityToAuthUserDto(userToEntity(user));
  }
}