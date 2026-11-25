import { test, expect } from "@playwright/test";
import {
  backupFileName,
  buildPgDumpCommand,
  isDailyBackupDue,
  msUntilNextHour,
  parseBackupName,
  selectBackupsToDelete,
} from "../../src/core/backup/backup.rules";

/** Reglas puras de los respaldos automáticos. Sin BD ni pg_dump. */

const DAY = 24 * 60 * 60 * 1000;

test.describe("buildPgDumpCommand", () => {
  test("separa conexión, quita ?schema y manda la contraseña por env", () => {
    const { args, env } = buildPgDumpCommand(
      "postgresql://user:secret@db.local:5433/cartas?schema=public",
      "/b/x.tmp"
    );
    expect(args).toEqual([
      "--format=custom", "--no-owner", "--file", "/b/x.tmp",
      "--host", "db.local", "--port", "5433", "--username", "user", "--dbname", "cartas",
    ]);
    expect(args.join(" ")).not.toContain("secret");
    expect(args.join(" ")).not.toContain("schema");
    expect(env).toEqual({ PGPASSWORD: "secret" });
  });

  test("decodifica caracteres especiales de la contraseña", () => {
    const { env } = buildPgDumpCommand("postgresql://u:p%40ss%2Fw%3Ard%23@h:5432/d", "/x");
    expect(env.PGPASSWORD).toBe("p@ss/w:rd#");
  });

  test("sin puerto ni contraseña", () => {
    const { args, env } = buildPgDumpCommand("postgres://u@h/d", "/x");
    expect(args).not.toContain("--port");
    expect(env).toEqual({});
  });

  test("rechaza URL que no es postgres o sin base", () => {
    expect(() => buildPgDumpCommand("mysql://u:p@h/d", "/x")).toThrow();
    expect(() => buildPgDumpCommand("postgresql://u:p@h/", "/x")).toThrow();
  });
});

test.describe("nombres", () => {
  test("usa la hora local de la zona", () => {
    const instant = new Date("2026-03-05T03:04:05Z"); // 21:04:05 del 4 en CDMX (UTC-6)
    expect(backupFileName(instant, "America/Mexico_City", "daily")).toBe("cartas-20260304-210405-daily.dump");
    expect(backupFileName(instant, "UTC", "pre-migrate")).toBe("cartas-20260305-030405-pre-migrate.dump");
  });

  test("parseBackupName solo acepta el patrón", () => {
    expect(parseBackupName("cartas-20260304-210405-daily.dump")?.reason).toBe("daily");
    expect(parseBackupName("cartas-20260304-210405-pre-migrate.dump")?.stamp).toBe("20260304210405");
    expect(parseBackupName("cartas-20260304-210405-daily.dump.tmp")).toBeNull();
    expect(parseBackupName("notas.txt")).toBeNull();
    expect(parseBackupName("cartas-2026-10-02.dump")).toBeNull();
  });
});

test.describe("retención", () => {
  const now = Date.UTC(2026, 5, 30);
  const policy = { keepDays: 14, keepPreMigrate: 2 };

  test("borra diarios viejos y pre-migrate sobrantes; respeta lo ajeno", () => {
    const files = [
      { name: "cartas-20260629-030000-daily.dump", mtimeMs: now - 1 * DAY },
      { name: "cartas-20260601-030000-daily.dump", mtimeMs: now - 29 * DAY },
      { name: "cartas-20260101-000000-pre-migrate.dump", mtimeMs: now - 180 * DAY },
      { name: "cartas-20260201-000000-pre-migrate.dump", mtimeMs: now - 150 * DAY },
      { name: "cartas-20260301-000000-pre-migrate.dump", mtimeMs: now - 120 * DAY },
      { name: "cartas-2026-10-02.dump", mtimeMs: now - 300 * DAY },
      { name: "cartas-20260101-000000-daily.dump.tmp", mtimeMs: now - 300 * DAY },
      { name: "README.txt", mtimeMs: now - 300 * DAY },
    ];
    expect(selectBackupsToDelete(files, policy, now).sort()).toEqual([
      "cartas-20260101-000000-pre-migrate.dump",
      "cartas-20260601-030000-daily.dump",
    ]);
  });

  test("los pre-migrate viejos se conservan si caben en el tope", () => {
    const files = [{ name: "cartas-20250101-000000-pre-migrate.dump", mtimeMs: now - 500 * DAY }];
    expect(selectBackupsToDelete(files, policy, now)).toEqual([]);
  });
});

test.describe("programación", () => {
  test("isDailyBackupDue", () => {
    expect(isDailyBackupDue(null, 1000)).toBe(true);
    expect(isDailyBackupDue(1000, 1000 + DAY - 1)).toBe(false);
    expect(isDailyBackupDue(1000, 1000 + DAY + 1)).toBe(true);
  });

  test("msUntilNextHour: hoy si falta, mañana si ya pasó", () => {
    const h = 3600 * 1000;
    expect(msUntilNextHour(new Date("2026-03-05T01:00:00Z"), 3, "UTC")).toBe(2 * h);
    expect(msUntilNextHour(new Date("2026-03-05T03:00:00Z"), 3, "UTC")).toBe(24 * h);
    expect(msUntilNextHour(new Date("2026-03-05T04:30:00Z"), 3, "UTC")).toBe(22.5 * h);
  });
});
