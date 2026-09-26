import { t } from "@core/i18n";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

const MIN_PASSWORD_LENGTH = 6;

export interface UserImportRow {
  name: string;
  username: string;
  password: string;
}

export interface UserImportResult {
  created: number;
  skipped: { rowNumber: number; username: string; reason: string }[];
}

export class UserImportService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  // Carga masiva de empleados desde Excel: cada fila crea un usuario con rol
  // EMPLEADO, sin departamento (se asigna después manualmente). Si el username
  // ya existe, esa fila se omite y se reporta al final en vez de detener todo.
  async import(rows: UserImportRow[]): Promise<UserImportResult> {
    const result: UserImportResult = { created: 0, skipped: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1

      if (!row.name?.trim() || !row.username?.trim() || !row.password?.trim()) {
        result.skipped.push({
          rowNumber,
          username: row.username || t("labels.empty"),
          reason: t("userImport.missingData"),
        });
        continue;
      }

      const username = row.username.trim().toLowerCase();
      const exists = await this.db.user.findUnique({ where: { username } });
      if (exists) {
        result.skipped.push({ rowNumber, username, reason: t("userImport.usernameExists") });
        continue;
      }

      if (row.password.trim().length < MIN_PASSWORD_LENGTH) {
        result.skipped.push({
          rowNumber,
          username,
          reason: t("userImport.passwordTooShort", { min: MIN_PASSWORD_LENGTH }),
        });
        continue;
      }

      await this.db.user.create({
        data: {
          username,
          password: await hashPassword(row.password.trim()),
          name: row.name.trim(),
          role: "EMPLOYEE",
        },
      });
      result.created += 1;
    }

    return result;
  }
}