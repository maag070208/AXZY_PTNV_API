import { t } from "@core/i18n";
import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

const MIN_PASSWORD_LENGTH = 6;

export interface UserImportRow {
  name: string;
  username: string;
  password: string;
  employeeNumber?: string;
}

export interface UserImportResult {
  created: number;
  skipped: { row: number; username: string; reason: string }[];
}

/** Usuarios creados (para el alta posterior en relojes); no se expone en la respuesta. */
export interface UserImportOutcome extends UserImportResult {
  createdUsers: { id: string; role: string; employeeNumber: string | null }[];
}

/** Número de empleado opcional: recortado, o null si viene vacío. **Puro.** */
export const normalizeEmployeeNumber = (raw: string | undefined | null): string | null => {
  const value = (raw ?? "").toString().trim();
  return value ? value : null;
};

/**
 * ¿El número ya se usó antes en el mismo archivo? Si no, lo registra. **Puro**
 * (solo muta el `Set` recibido).
 */
export const isDuplicateInFile = (seen: Set<string>, employeeNumber: string): boolean => {
  if (seen.has(employeeNumber)) return true;
  seen.add(employeeNumber);
  return false;
};

export class UserImportService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  // Carga masiva de empleados desde Excel: cada fila crea un usuario con rol
  // EMPLEADO, sin departamento (se asigna después manualmente). Si el username
  // ya existe, esa fila se omite y se reporta al final en vez de detener todo.
  async import(rows: UserImportRow[]): Promise<UserImportOutcome> {
    const result: UserImportOutcome = { created: 0, skipped: [], createdUsers: [] };
    const seenNumbers = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1

      if (!row.name?.trim() || !row.username?.trim() || !row.password?.trim()) {
        result.skipped.push({
          row: rowNumber,
          username: row.username || t("labels.empty"),
          reason: t("userImport.missingData"),
        });
        continue;
      }

      const username = row.username.trim().toLowerCase();
      const exists = await this.db.user.findUnique({ where: { username } });
      if (exists) {
        result.skipped.push({ row: rowNumber, username, reason: t("userImport.usernameExists") });
        continue;
      }

      if (row.password.trim().length < MIN_PASSWORD_LENGTH) {
        result.skipped.push({
          row: rowNumber,
          username,
          reason: t("userImport.passwordTooShort", { min: MIN_PASSWORD_LENGTH }),
        });
        continue;
      }

      const employeeNumber = normalizeEmployeeNumber(row.employeeNumber);
      if (employeeNumber) {
        const numberTaken =
          isDuplicateInFile(seenNumbers, employeeNumber) ||
          !!(await this.db.user.findFirst({ where: { employeeNumber }, select: { id: true } }));
        if (numberTaken) {
          result.skipped.push({ row: rowNumber, username, reason: t("userImport.employeeNumberExists") });
          continue;
        }
      }

      const created = await this.db.user.create({
        data: {
          username,
          password: await hashPassword(row.password.trim()),
          name: row.name.trim(),
          role: "EMPLOYEE",
          employeeNumber,
        },
        select: { id: true, role: true, employeeNumber: true },
      });
      result.created += 1;
      result.createdUsers.push(created);
    }

    return result;
  }
}