import { MetodoChecada, type Prisma, type PrismaClient } from "@prisma/client";
import { prismaClient } from "@core/config/database";
import { paginatedQuery } from "@core/db/table";
import { HttpError } from "@core/middlewares/error.middleware";
import { logger } from "@core/utils/logger";
import {
  ci,
  orderByOf,
  type ITDataTableFetchParams,
  type ITDataTableResponse,
} from "@core/utils/table";
import {
  endOfLocalDay,
  parseDateFilter,
  resolveTimezoneWithConfig,
  startOfLocalDay,
} from "@core/utils/timezone";
import { IsapiAuthError, type IsapiClient } from "./isapi.client";
import type { ChecadorImportInput } from "../models/dto/checador.dto";
import type {
  AcsEventInfo,
  ChecadorCorrida,
  ChecadorImportacion,
  ChecadorProgreso,
  ChecadorStatus,
} from "../models/entity/checador.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/**
 * Consecutivos por ventana cuando hay rezago (la carga inicial del historial).
 * Cada ventana terminada confirma el cursor: un reinicio a media carga solo
 * repite la ventana en curso, no todo el historial.
 */
const VENTANA_SERIAL = 5000;

/** `minor` ISAPI (major 5) → cómo se identificó el empleado. */
const METODO_POR_MINOR: Record<number, MetodoChecada> = {
  1: "TARJETA", // tarjeta válida
  38: "HUELLA", // huella coincide
  75: "ROSTRO", // rostro coincide
};

const checadaSelect = {
  id: true,
  dispositivoSerie: true,
  serialNo: true,
  numeroEmpleado: true,
  nombre: true,
  metodo: true,
  minor: true,
  occurredAt: true,
  createdAt: true,
} satisfies Prisma.ChecadaSelect;

const assertMetodo = (value: unknown): MetodoChecada => {
  const metodo = String(value).toUpperCase();
  if (!(Object.values(MetodoChecada) as string[]).includes(metodo)) {
    throw new HttpError(400, {
      code: "INVALID_METODO",
      message: `Método "${String(value)}" inválido (ROSTRO, HUELLA, TARJETA u OTRO)`,
    });
  }
  return metodo as MetodoChecada;
};

/** Evento ISAPI → fila de `checadas`; `null` si el reloj mandó una hora ilegible. */
const toChecada = (
  dispositivoSerie: string,
  e: AcsEventInfo
): Prisma.ChecadaCreateManyInput | null => {
  const occurredAt = new Date(e.time);
  if (Number.isNaN(occurredAt.getTime())) {
    logger.warn(`[checador] evento ${e.serialNo} con hora ilegible ("${e.time}"): se omite`);
    return null;
  }
  return {
    dispositivoSerie,
    serialNo: e.serialNo,
    numeroEmpleado: e.employeeNoString ?? "",
    nombre: e.name?.trim() ?? "",
    metodo: METODO_POR_MINOR[e.minor] ?? "OTRO",
    minor: e.minor,
    occurredAt,
  };
};

export class ChecadorService {
  /** Corrida en curso; también es el candado para no traslapar corridas. */
  private enCurso: ChecadorStatus["enCurso"] = null;
  private ultimaCorrida: ChecadorCorrida | null = null;
  /** Importación manual en curso o la última (en curso ⇔ `finishedAt` null). */
  private importacion: ChecadorImportacion | null = null;
  private pausadoPorCredenciales = false;

  constructor(
    private readonly db: PrismaClient = prismaClient,
    /** `null` sin `CHECADOR_URL`: la tabla funciona, la sincronización no. */
    private readonly client: IsapiClient | null = null,
    private readonly sysConfig?: SysConfigReader
  ) {}

  // ── Consulta ────────────────────────────────────────────────────────────

  /** Tabla server-side de las checadas guardadas (contrato ITDataTable). */
  async table(params: ITDataTableFetchParams): Promise<ITDataTableResponse<unknown>> {
    const { filters } = params;
    const tz = await resolveTimezoneWithConfig(
      typeof filters.tz === "string" ? filters.tz : undefined,
      this.sysConfig
    );

    const where: Prisma.ChecadaWhereInput = {};
    if (typeof filters.q === "string" && filters.q.trim() !== "") {
      const q = filters.q.trim();
      where.OR = [{ nombre: ci(q) }, { numeroEmpleado: ci(q) }];
    }
    if (filters.numeroEmpleado !== undefined) where.numeroEmpleado = String(filters.numeroEmpleado);
    if (filters.metodo !== undefined) where.metodo = assertMetodo(filters.metodo);

    const desde = parseDateFilter(filters.desde, tz, "start");
    const hasta = parseDateFilter(filters.hasta, tz, "end");
    if (desde || hasta) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (desde) occurredAt.gte = desde;
      if (hasta) {
        // `YYYY-MM-DD` se resuelve como inicio del día siguiente (exclusivo);
        // un instante absoluto (con `T`) se respeta inclusive.
        if (String(filters.hasta).includes("T")) occurredAt.lte = hasta;
        else occurredAt.lt = hasta;
      }
      where.occurredAt = occurredAt;
    }

    // Desempate estable al final: sin él, filas con el mismo valor de orden (un
    // mismo nombre tiene cientos de checadas) se repiten o saltan entre páginas.
    const orderBy = [
      ...orderByOf(
        params.sort,
        { occurredAt: "occurredAt", nombre: "nombre", numeroEmpleado: "numeroEmpleado", metodo: "metodo" },
        [{ occurredAt: "desc" }]
      ),
      { serialNo: "desc" },
      { id: "asc" },
    ];

    return paginatedQuery({
      model: this.db.checada,
      where: where as Record<string, unknown>,
      orderBy,
      select: checadaSelect,
      page: params.page,
      limit: params.limit,
    });
  }

  async status(): Promise<ChecadorStatus> {
    const [cursores, totales] = await Promise.all([
      this.db.checadorSync.findMany({ orderBy: { updatedAt: "desc" } }),
      this.db.checada.groupBy({
        by: ["dispositivoSerie"],
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
    ]);
    const porSerie = new Map(totales.map((t) => [t.dispositivoSerie, t]));

    return {
      configurado: this.client !== null,
      enCurso: this.enCurso,
      pausadoPorCredenciales: this.pausadoPorCredenciales,
      ultimaCorrida: this.ultimaCorrida,
      importacion: this.importacion,
      dispositivos: cursores.map((c) => ({
        dispositivoSerie: c.dispositivoSerie,
        modelo: c.modelo,
        ultimoSerialNo: c.ultimoSerialNo,
        sincronizadoEn: c.sincronizadoEn,
        checadas: porSerie.get(c.dispositivoSerie)?._count._all ?? 0,
        ultimaChecada: porSerie.get(c.dispositivoSerie)?._max.occurredAt ?? null,
      })),
    };
  }

  // ── Sincronización (solo lectura del reloj) ─────────────────────────────

  /**
   * Importación manual por rango de días (`POST /checador/import`): lee del
   * reloj todos los eventos de esos días y guarda las checadas que falten. Corre
   * en segundo plano, tarde lo que tarde, y su avance sale en `status()`. Es
   * independiente de la sincronización periódica y del cursor: puede correr a
   * la vez, y los duplicados se descartan por el `@@unique` de `checadas`.
   */
  async importar(input: ChecadorImportInput): Promise<ChecadorImportacion> {
    if (input.desde > input.hasta) {
      throw new HttpError(400, {
        code: "INVALID_RANGE",
        message: "La fecha inicial no puede ser posterior a la final",
      });
    }
    const tz = await resolveTimezoneWithConfig(input.tz, this.sysConfig);
    const inicio = startOfLocalDay(input.desde, tz);
    // El reloj toma `endTime` inclusive: último segundo del día `hasta`.
    const fin = new Date(endOfLocalDay(input.hasta, tz).getTime() - 1000);

    if (!this.client) {
      throw new HttpError(503, {
        code: "CHECADOR_NOT_CONFIGURED",
        message: "El checador no está configurado (CHECADOR_URL)",
      });
    }
    if (this.importacion && !this.importacion.finishedAt) {
      throw new HttpError(409, {
        code: "CHECADOR_IMPORT_IN_PROGRESS",
        message: "Ya hay una importación en curso; espera a que termine",
      });
    }

    const importacion: ChecadorImportacion = {
      desde: input.desde,
      hasta: input.hasta,
      startedAt: new Date(),
      finishedAt: null,
      total: null,
      leidos: 0,
      nuevas: 0,
      error: null,
    };
    this.importacion = importacion;
    void this.runImport(this.client, importacion, inicio, fin);
    return importacion;
  }

  /**
   * Sincronización periódica: la primera corrida es inmediata (con la base
   * vacía trae todo el historial del reloj) y luego una cada `intervalMs`.
   * Si el reloj rechaza las credenciales se detiene hasta reiniciar la API.
   */
  startWorker(intervalMs: number): () => void {
    const client = this.client;
    if (!client) {
      logger.info("[checador] sin CHECADOR_URL: sincronización deshabilitada");
      return () => undefined;
    }
    const tick = (): void => {
      if (this.enCurso || this.pausadoPorCredenciales) return;
      void this.run(client);
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }

  /** Nunca lanza: el resultado (ok o error) queda en `ultimaCorrida`. */
  private async run(client: IsapiClient): Promise<ChecadorCorrida> {
    const progreso: ChecadorProgreso = { startedAt: new Date(), leidos: 0, nuevas: 0, restantes: null };
    this.enCurso = progreso;
    let dispositivoSerie: string | null = null;
    let confirmado: number | null = null;
    let corrida: ChecadorCorrida;

    try {
      const device = await client.deviceInfo();
      const serie = device.serialNumber;
      dispositivoSerie = serie;
      const cursor = await this.db.checadorSync.upsert({
        where: { dispositivoSerie: serie },
        create: { dispositivoSerie: serie, modelo: device.model },
        update: { modelo: device.model },
      });
      confirmado = cursor.ultimoSerialNo;
      const confirmar = async (ultimoSerialNo: number): Promise<void> => {
        await this.db.checadorSync.update({
          where: { dispositivoSerie: serie },
          data: { ultimoSerialNo, sincronizadoEn: new Date() },
        });
        confirmado = ultimoSerialNo;
      };

      let desde = cursor.ultimoSerialNo + 1;
      let ultimoSerialNo = cursor.ultimoSerialNo;
      for (;;) {
        const busqueda = client.acsEvents(desde);
        const primera = await busqueda.next();
        if (primera.done) break; // nada nuevo
        progreso.restantes = primera.value.totalMatches;

        if (primera.value.totalMatches > VENTANA_SERIAL) {
          // Rezago grande (carga inicial). Hay más eventos pendientes que
          // consecutivos en la ventana, así que el reloj ya pasó de `hasta`: la
          // ventana está completa y su cierre es un cursor exacto aunque tenga
          // huecos. Se confirma para que un reinicio no la vuelva a leer.
          await busqueda.return(undefined);
          const hasta = desde + VENTANA_SERIAL - 1;
          for await (const { eventos } of client.acsEvents(desde, hasta)) {
            await this.guardar(serie, eventos, progreso);
          }
          await confirmar(hasta);
          ultimoSerialNo = hasta;
          desde = hasta + 1;
          continue;
        }

        // Cola final (lo normal en cada ciclo): se procesa completa y el cursor
        // queda en el mayor consecutivo leído.
        ultimoSerialNo = Math.max(ultimoSerialNo, await this.guardar(serie, primera.value.eventos, progreso));
        for await (const { eventos } of busqueda) {
          ultimoSerialNo = Math.max(ultimoSerialNo, await this.guardar(serie, eventos, progreso));
        }
        break;
      }
      await confirmar(ultimoSerialNo);

      this.pausadoPorCredenciales = false;
      if (progreso.nuevas > 0) {
        logger.info(
          `[checador] ${progreso.nuevas} checadas nuevas (${progreso.leidos} eventos leídos, consecutivo ${ultimoSerialNo})`
        );
      }
      corrida = {
        ok: true,
        dispositivoSerie,
        startedAt: progreso.startedAt,
        finishedAt: new Date(),
        leidos: progreso.leidos,
        nuevas: progreso.nuevas,
        ultimoSerialNo,
        error: null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (err instanceof IsapiAuthError) {
        this.pausadoPorCredenciales = true;
        logger.error(
          `[checador] ${error}. Sincronización automática en pausa hasta reiniciar la API, para no bloquear la cuenta en el reloj.`
        );
      } else {
        logger.error(`[checador] sincronización fallida: ${error}`);
      }
      corrida = {
        ok: false,
        dispositivoSerie,
        startedAt: progreso.startedAt,
        finishedAt: new Date(),
        leidos: progreso.leidos,
        nuevas: progreso.nuevas,
        ultimoSerialNo: confirmado,
        error,
      };
    } finally {
      this.enCurso = null;
    }
    this.ultimaCorrida = corrida;
    return corrida;
  }

  /** Nunca lanza: el resultado (o el error) queda en la misma `importacion`. */
  private async runImport(
    client: IsapiClient,
    importacion: ChecadorImportacion,
    inicio: Date,
    fin: Date
  ): Promise<void> {
    const rango = `${importacion.desde} a ${importacion.hasta}`;
    try {
      const { serialNumber: serie } = await client.deviceInfo();
      for await (const { totalMatches, eventos } of client.acsEventsBetween(inicio, fin)) {
        importacion.total = totalMatches;
        await this.guardar(serie, eventos, importacion);
      }
      logger.info(
        `[checador] importación ${rango}: ${importacion.nuevas} checadas nuevas (${importacion.leidos} eventos leídos)`
      );
    } catch (err) {
      importacion.error = err instanceof Error ? err.message : String(err);
      if (err instanceof IsapiAuthError) this.pausadoPorCredenciales = true;
      logger.error(`[checador] importación ${rango} fallida: ${importacion.error}`);
    } finally {
      importacion.finishedAt = new Date();
    }
  }

  /** Guarda las checadas de una página; devuelve el mayor consecutivo leído. */
  private async guardar(
    serie: string,
    eventos: AcsEventInfo[],
    progreso: Pick<ChecadorProgreso, "leidos" | "nuevas">
  ): Promise<number> {
    progreso.leidos += eventos.length;
    // Solo las checadas: eventos con empleado identificado (el resto son de puerta).
    const data = eventos
      .filter((e) => e.employeeNoString)
      .map((e) => toChecada(serie, e))
      .filter((c): c is Prisma.ChecadaCreateManyInput => c !== null);
    if (data.length > 0) {
      const { count } = await this.db.checada.createMany({ data, skipDuplicates: true });
      progreso.nuevas += count;
    }
    if (progreso.leidos % 5000 < eventos.length) {
      logger.info(`[checador] ${progreso.leidos} eventos leídos, ${progreso.nuevas} checadas nuevas…`);
    }
    return Math.max(...eventos.map((e) => e.serialNo));
  }
}
