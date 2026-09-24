import type { PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { HttpError } from "@core/middlewares/error.middleware";
import { ci, type ITDataTableFetchParams } from "@core/utils/table";
import type { AuditLogger } from "@modules/users/services/user.service";
import type {
  ChecadorEmpleadoRow,
  ChecadorEmpleadosSummary,
  ChecadorUsuarioRef,
} from "../models/entity/checador.entity";

// ── Sugerencias de vínculo ───────────────────────────────────────────────────
//
// El número del reloj NO es el `numeroEmpleado` del sistema: el reloj antepone
// el área (070562 ↔ 562) y el número de nómina se repite entre áreas (040001 y
// 110001). Por eso el vínculo es explícito y aquí solo se SUGIERE: el nombre
// tiene que coincidir siempre (en cualquier orden) y el número solo sube la
// confianza. Ver CHECADOR.md §4.

/** Partículas que no distinguen a nadie ("MARIA DE LOS ANGELES"). */
const PARTICULAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

/** Palabras del nombre en mayúsculas, sin acentos ni partículas. */
const palabras = (nombre: string): string[] =>
  nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p.length > 1 && !PARTICULAS.has(p));

/**
 * Mismo nombre aunque cambie el orden. Los hermanos comparten los dos
 * apellidos, así que con nombres de 3+ palabras se piden 3 en común.
 */
const nombreCoincide = (a: string[], b: string[]): boolean => {
  const enB = new Set(b);
  const comunes = new Set(a.filter((p) => enB.has(p))).size;
  return comunes >= 2 && comunes >= Math.min(3, a.length, b.length);
};

/** Número de nómina de un número del reloj: sin el prefijo de área (070562 → 562). */
const nominaDelReloj = (numero: string): number | null => {
  if (/^\d{6}$/.test(numero)) return Number(numero.slice(2));
  return /^\d+$/.test(numero) ? Number(numero) : null;
};

const numeroCoincide = (numeroReloj: string, numeroUsuario: string | null): boolean => {
  const nomina = nominaDelReloj(numeroReloj);
  return (
    nomina !== null && numeroUsuario !== null && /^\d+$/.test(numeroUsuario) && Number(numeroUsuario) === nomina
  );
};

type Candidato = ChecadorUsuarioRef & { palabras: string[] };

const sugerir = (
  numero: string,
  nombre: string,
  candidatos: Candidato[]
): ChecadorEmpleadoRow["sugerencia"] => {
  const delReloj = palabras(nombre);
  const porNombre = candidatos.filter((c) => nombreCoincide(delReloj, c.palabras));
  const porNumero = porNombre.filter((c) => numeroCoincide(numero, c.numeroEmpleado));
  const [elegido, confianza] =
    porNumero.length === 1
      ? [porNumero[0], "ALTA" as const]
      : porNombre.length === 1
        ? [porNombre[0], "MEDIA" as const]
        : [null, null];
  if (!elegido || !confianza) return null;
  const { palabras: _palabras, ...usuario } = elegido;
  return { ...usuario, confianza };
};

const usuarioSelect = { id: true, name: true, numeroEmpleado: true, active: true } as const;

const toRef = (u: { id: string; name: string; numeroEmpleado: string | null; active: boolean }): ChecadorUsuarioRef => ({
  userId: u.id,
  name: u.name,
  numeroEmpleado: u.numeroEmpleado,
  active: u.active,
});

/**
 * Empleados del reloj (vistos en sus checadas) y su vínculo con los usuarios
 * del sistema: tabla con sugerencias, vincular, desvincular y vincular de un
 * jalón las sugerencias `ALTA`.
 */
export class ChecadorEmpleadosService {
  constructor(
    private readonly db: PrismaClient = prismaClient,
    private readonly audit?: AuditLogger
  ) {}

  /** Tabla de empleados del reloj; se resuelve en memoria (unos cientos de filas). */
  async table(params: ITDataTableFetchParams) {
    const filas = await this.filas();
    const { filters } = params;

    const q = ci(filters.q)?.contains.toLowerCase();
    const estado = typeof filters.estado === "string" ? filters.estado : undefined;
    const filtradas = filas.filter((f) => {
      if (estado === "VINCULADO" && !f.vinculo) return false;
      if (estado === "SIN_VINCULAR" && f.vinculo) return false;
      if (estado === "SUGERIDO" && (f.vinculo || !f.sugerencia)) return false;
      if (q) {
        const texto = [f.numeroEmpleado, f.nombre, f.vinculo?.name, f.vinculo?.numeroEmpleado]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });

    const sorters: Record<string, (a: ChecadorEmpleadoRow, b: ChecadorEmpleadoRow) => number> = {
      numeroEmpleado: (a, b) => a.numeroEmpleado.localeCompare(b.numeroEmpleado),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre),
      checadas: (a, b) => a.checadas - b.checadas,
      ultimaChecada: (a, b) => a.ultimaChecada.getTime() - b.ultimaChecada.getTime(),
    };
    const sorter = (params.sort && sorters[params.sort.key]) ?? sorters.nombre;
    const ordenadas = [...filtradas].sort(sorter);
    if (params.sort?.direction === "desc") ordenadas.reverse();

    const from = (params.page - 1) * params.limit;
    return {
      data: ordenadas.slice(from, from + params.limit),
      total: ordenadas.length,
      summary: this.resumen(filas),
    };
  }

  /** Vincula (o cambia el vínculo de) un número del reloj con un usuario. */
  async vincular(numeroEmpleado: string, userId: string, actorId?: string): Promise<ChecadorEmpleadoRow> {
    const enReloj = await this.db.checada.findFirst({ where: { numeroEmpleado }, select: { id: true } });
    if (!enReloj) {
      throw new HttpError(404, {
        code: "CHECADOR_EMPLEADO_NOT_FOUND",
        message: `El número ${numeroEmpleado} no tiene checadas en el reloj`,
      });
    }
    const user = await this.db.user.findUnique({ where: { id: userId }, select: usuarioSelect });
    if (!user) throw new HttpError(404, { code: "USER_NOT_FOUND", message: "Usuario no encontrado" });

    await this.db.checadorEmpleado.upsert({
      where: { numeroEmpleado },
      create: { numeroEmpleado, userId, vinculadoPorId: actorId ?? null },
      update: { userId, vinculadoPorId: actorId ?? null },
    });
    await this.audit?.({
      action: "CHECADOR_VINCULAR",
      entityType: "ChecadorEmpleado",
      entityId: numeroEmpleado,
      userId: actorId,
      metadata: { numeroEmpleado, usuario: user.name, usuarioId: user.id },
    });

    const fila = (await this.filas()).find((f) => f.numeroEmpleado === numeroEmpleado);
    return fila!;
  }

  async desvincular(numeroEmpleado: string, actorId?: string): Promise<{ numeroEmpleado: string }> {
    const vinculo = await this.db.checadorEmpleado.findUnique({ where: { numeroEmpleado } });
    if (!vinculo) {
      throw new HttpError(404, {
        code: "CHECADOR_VINCULO_NOT_FOUND",
        message: `El número ${numeroEmpleado} no está vinculado`,
      });
    }
    await this.db.checadorEmpleado.delete({ where: { numeroEmpleado } });
    await this.audit?.({
      action: "CHECADOR_DESVINCULAR",
      entityType: "ChecadorEmpleado",
      entityId: numeroEmpleado,
      userId: actorId,
      metadata: { numeroEmpleado, usuarioId: vinculo.userId },
    });
    return { numeroEmpleado };
  }

  /** Vincula de un jalón las sugerencias `ALTA` (nombre y número coinciden). */
  async vincularSugeridos(actorId?: string): Promise<{ vinculados: number }> {
    const sugeridas = (await this.filas()).filter(
      (f) => !f.vinculo && f.sugerencia?.confianza === "ALTA"
    );
    if (sugeridas.length === 0) return { vinculados: 0 };

    const { count } = await this.db.checadorEmpleado.createMany({
      data: sugeridas.map((f) => ({
        numeroEmpleado: f.numeroEmpleado,
        userId: f.sugerencia!.userId,
        vinculadoPorId: actorId ?? null,
      })),
      skipDuplicates: true,
    });
    for (const f of sugeridas) {
      await this.audit?.({
        action: "CHECADOR_VINCULAR",
        entityType: "ChecadorEmpleado",
        entityId: f.numeroEmpleado,
        userId: actorId,
        metadata: {
          numeroEmpleado: f.numeroEmpleado,
          usuario: f.sugerencia!.name,
          usuarioId: f.sugerencia!.userId,
          sugerencia: "ALTA",
        },
      });
    }
    return { vinculados: count };
  }

  // ── Cálculo ────────────────────────────────────────────────────────────────

  /** Todos los empleados del reloj con su vínculo o su sugerencia. */
  private async filas(): Promise<ChecadorEmpleadoRow[]> {
    const [delReloj, vinculos, libres] = await Promise.all([
      this.db.$queryRaw<{ numeroEmpleado: string; nombre: string; checadas: number; ultimaChecada: Date }[]>`
        SELECT "numeroEmpleado",
               (array_agg("nombre" ORDER BY "occurredAt" DESC))[1] AS "nombre",
               count(*)::int AS "checadas",
               max("occurredAt") AS "ultimaChecada"
        FROM "checadas"
        GROUP BY "numeroEmpleado"`,
      this.db.checadorEmpleado.findMany({ select: { numeroEmpleado: true, user: { select: usuarioSelect } } }),
      // Se sugieren usuarios que aún no tienen número del reloj, también los
      // dados de baja: el vínculo es de identidad, y una baja que sigue
      // checando es justo algo que RH tiene que ver.
      this.db.user.findMany({
        where: { checadorEmpleados: { none: {} } },
        select: usuarioSelect,
      }),
    ]);

    const porNumero = new Map(vinculos.map((v) => [v.numeroEmpleado, toRef(v.user)]));
    const candidatos: Candidato[] = libres.map((u) => ({ ...toRef(u), palabras: palabras(u.name) }));

    return delReloj.map((r) => {
      const vinculo = porNumero.get(r.numeroEmpleado) ?? null;
      return {
        numeroEmpleado: r.numeroEmpleado,
        nombre: r.nombre,
        checadas: r.checadas,
        ultimaChecada: r.ultimaChecada,
        vinculo,
        sugerencia: vinculo ? null : sugerir(r.numeroEmpleado, r.nombre, candidatos),
      };
    });
  }

  private resumen(filas: ChecadorEmpleadoRow[]): ChecadorEmpleadosSummary {
    const vinculados = filas.filter((f) => f.vinculo).length;
    return {
      total: filas.length,
      vinculados,
      sinVincular: filas.length - vinculados,
      sugeridosAlta: filas.filter((f) => !f.vinculo && f.sugerencia?.confianza === "ALTA").length,
    };
  }
}
