import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { hashPassword } from "@core/utils/security";

export interface UserImportRow {
  name: string;
  username: string;
  password: string;
}

export interface UserImportResult {
  creados: number;
  omitidos: { fila: number; username: string; motivo: string }[];
}

export class UserImportService {
  constructor(private readonly db: PrismaClient = prismaClient) {}

  // Carga masiva de empleados desde Excel: cada fila crea un usuario con rol
  // EMPLEADO, sin departamento (se asigna después manualmente). Si el username
  // ya existe, esa fila se omite y se reporta al final en vez de detener todo.
  async import(rows: UserImportRow[]): Promise<UserImportResult> {
    const result: UserImportResult = { creados: 0, omitidos: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const fila = i + 2; // +1 por el encabezado, +1 porque Excel empieza en 1

      if (!row.name?.trim() || !row.username?.trim() || !row.password?.trim()) {
        result.omitidos.push({
          fila,
          username: row.username || "(vacío)",
          motivo: "Faltan datos (nombre, usuario o contraseña)",
        });
        continue;
      }

      const username = row.username.trim().toLowerCase();
      const exists = await this.db.user.findUnique({ where: { username } });
      if (exists) {
        result.omitidos.push({ fila, username, motivo: "El username ya existe" });
        continue;
      }

      if (row.password.trim().length < 6) {
        result.omitidos.push({
          fila,
          username,
          motivo: "Contraseña muy corta (mínimo 6 caracteres)",
        });
        continue;
      }

      await this.db.user.create({
        data: {
          username,
          password: await hashPassword(row.password.trim()),
          name: row.name.trim(),
          role: "EMPLEADO",
        },
      });
      result.creados += 1;
    }

    return result;
  }
}