import { MetodoChecada, type ChecadorReloj, type Prisma, type PrismaClient } from "@prisma/client";
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
import type { AuditLogger } from "@modules/users/services/user.service";
import { IsapiAuthError, IsapiClient } from "./isapi.client";
import type {
  ChecadorImportInput,
  ChecadorRelojInput,
  ChecadorRelojUpdate,
} from "../models/dto/checador.dto";
import type {
  AcsEventInfo,
  ChecadorCorrida,
  ChecadorDeviceInfo,
  ChecadorDispositivoStatus,
  ChecadorImportacion,
  ChecadorProgreso,
  ChecadorRelojConfig,
  ChecadorStatus,
} from "../models/entity/checador.entity";

type SysConfigReader = (key: string) => Promise<string | null>;

/** Usuario y contraseña de los relojes: los mismos para todos. */
export interface ChecadorCredenciales {
  user: string;
  pass: string;
}

/** Un reloj dado de alta (tiene dirección). */
type RelojRegistrado = ChecadorReloj & { url: string };

const estaRegistrado = (reloj: ChecadorReloj | null): reloj is RelojRegistrado =>
  reloj !== null && reloj.url !== null;

/** Estado en memoria de la sincronización de un reloj. */
interface EstadoReloj {
  /** Corrida en curso; también es el candado para no traslapar corridas del reloj. */
  enCurso: ChecadorProgreso | null;
  ultimaCorrida: ChecadorCorrida | null;
  /** Rechazó las credenciales: el worker no lo vuelve a intentar solo. */
  pausadoPorCredenciales: boolean;
  /** Se dio de baja a media corrida: la corrida para en la siguiente página. */
  detener: boolean;
}

/** La corrida se detuvo porque el reloj se dio de baja. */
class RelojDadoDeBaja extends Error {
  constructor() {
    super("Se dio de baja durante la sincronización");
  }
}

/**
 * Espera máxima por el reloj cuando alguien espera la respuesta (alta y
 * configuración): la web corta a los 30 s y el reloj contesta en menos de 1 s.
 */
const TIMEOUT_INTERACTIVO_MS = 10_000;

/**
 * Consecutivos por ventana. Cada ventana terminada confirma el cursor y
 * actualiza el avance: un reinicio a media carga solo repite la ventana en
 * curso, no todo el historial.
 */
const VENTANA_SERIAL = 5000;

/** `minor` ISAPI (major 5) → cómo se identificó el empleado. */
const METODO_POR_MINOR: Record<number, MetodoChecada> = {
  1: "TARJETA", // tarjeta válida
  38: "HUELLA", // huella coincide
  75: "ROSTRO", // rostro coincide
};

/**
 * Lo único que se le pide al reloj: las checadas válidas. Los eventos de
 * puerta (abrir/cerrar) y los intentos fallidos no se leen; en un reloj de
 * oficina son más del 90% de los eventos.
 */
const MINORS_CHECADA = Object.keys(METODO_POR_MINOR).map(Number);

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

type ChecadaRow = Prisma.ChecadaGetPayload<{ select: typeof checadaSelect }>;

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

/**
 * La dirección del reloj como la escriben (`192.168.1.132`, o la URL copiada
 * del navegador, con ruta y `#`) → `http(s)://host[:puerto]`. Sin esquema se
 * asume https.
 */
const normalizarUrl = (valor: string): string => {
  const invalida = new HttpError(400, {
    code: "INVALID_URL",
    message: `"${valor}" no es una dirección válida (p. ej. https://192.168.1.132)`,
  });
  const texto = valor.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    throw invalida;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw invalida;
  }
  return url.origin;
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

const mensajeDe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class ChecadorService {
  /** Estado de la sincronización de cada reloj, por serie. */
  private readonly estados = new Map<string, EstadoReloj>();
  /** Importación manual en curso o la última (en curso ⇔ `finishedAt` null). */
  private importacion: ChecadorImportacion | null = null;

  constructor(
    private readonly db: PrismaClient = prismaClient,
    /** `null` sin `CHECADOR_USER`: las checadas se consultan, pero no se sincroniza. */
    private readonly credenciales: ChecadorCredenciales | null = null,
    private readonly sysConfig?: SysConfigReader,
    private readonly audit?: AuditLogger
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
    if (filters.dispositivoSerie !== undefined) where.dispositivoSerie = String(filters.dispositivoSerie);
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

    const [pagina, relojes] = await Promise.all([
      paginatedQuery<ChecadaRow>({
        model: this.db.checada,
        where: where as Record<string, unknown>,
        orderBy,
        select: checadaSelect,
        page: params.page,
        limit: params.limit,
      }),
      this.db.checadorReloj.findMany({ select: { dispositivoSerie: true, nombre: true } }),
    ]);
    // El nombre del reloj se queda aunque se dé de baja: sus checadas lo conservan.
    const nombres = new Map(relojes.map((r) => [r.dispositivoSerie, r.nombre]));
    return {
      ...pagina,
      data: pagina.data.map((c) => ({ ...c, reloj: nombres.get(c.dispositivoSerie) ?? null })),
    };
  }

  async status(): Promise<ChecadorStatus> {
    return {
      configurado: this.credenciales !== null,
      enCurso: this.enCursoTotal(),
      importacion: this.importacion,
      dispositivos: await this.estadoDe(await this.registrados()),
    };
  }

  // ── Relojes: alta, baja y configuración (del reloj solo se LEE) ──────────

  /**
   * Da de alta un reloj. Antes lee su identidad, que confirma la dirección y
   * las credenciales y da su serie, y luego arranca su primera sincronización.
   * Un reloj que ya estuvo dado de alta sigue desde su cursor.
   */
  async registrar(input: ChecadorRelojInput, actorId?: string): Promise<ChecadorDispositivoStatus> {
    const url = normalizarUrl(input.url);
    const client = this.cliente(url, TIMEOUT_INTERACTIVO_MS);
    const mismaUrl = await this.db.checadorReloj.findUnique({ where: { url } });
    if (mismaUrl) throw this.duplicado(mismaUrl);

    const info = await this.conectar(client, url);
    const previo = await this.db.checadorReloj.findUnique({
      where: { dispositivoSerie: info.serialNumber },
    });
    if (previo?.url) throw this.duplicado(previo);

    const nombre = input.nombre?.trim() || info.deviceName || info.serialNumber;
    const asistencia = input.asistencia ?? true;
    const reloj = await this.db.checadorReloj.upsert({
      where: { dispositivoSerie: info.serialNumber },
      create: { dispositivoSerie: info.serialNumber, url, nombre, asistencia, modelo: info.model },
      update: { url, nombre, asistencia, modelo: info.model },
    });
    if (!estaRegistrado(reloj)) throw new Error("El reloj quedó sin dirección");
    await this.audit?.({
      action: "CHECADOR_RELOJ_ALTA",
      entityType: "ChecadorReloj",
      entityId: reloj.dispositivoSerie,
      userId: actorId,
      metadata: { url, nombre, asistencia, modelo: info.model },
    });

    // Un alta es un intento explícito: quita una pausa por credenciales previa.
    const estado = this.estado(reloj.dispositivoSerie);
    estado.pausadoPorCredenciales = false;
    estado.detener = false;
    if (!estado.enCurso) void this.run(reloj);
    const [fila] = await this.estadoDe([reloj]);
    return fila;
  }

  /**
   * Cambia cómo usa el sistema al reloj: su nombre y si sus checadas cuentan
   * para entradas/salidas. Solo es el registro del sistema: el reloj no se toca.
   */
  async actualizar(
    serie: string,
    input: ChecadorRelojUpdate,
    actorId?: string
  ): Promise<ChecadorDispositivoStatus> {
    const antes = await this.registrado(serie);
    const reloj = await this.db.checadorReloj.update({
      where: { dispositivoSerie: serie },
      data: { nombre: input.nombre?.trim(), asistencia: input.asistencia },
    });
    if (!estaRegistrado(reloj)) throw new Error("El reloj quedó sin dirección");
    await this.audit?.({
      action: "CHECADOR_RELOJ_EDITAR",
      entityType: "ChecadorReloj",
      entityId: serie,
      userId: actorId,
      metadata: {
        antes: { nombre: antes.nombre, asistencia: antes.asistencia },
        despues: { nombre: reloj.nombre, asistencia: reloj.asistencia },
      },
    });
    const [fila] = await this.estadoDe([reloj]);
    return fila;
  }

  /** Da de baja un reloj: deja de sincronizarse; su cursor y sus checadas se quedan. */
  async darDeBaja(serie: string, actorId?: string): Promise<{ dispositivoSerie: string }> {
    const reloj = await this.registrado(serie);
    await this.db.checadorReloj.update({ where: { dispositivoSerie: serie }, data: { url: null } });
    const estado = this.estados.get(serie);
    if (estado?.enCurso) estado.detener = true;
    await this.audit?.({
      action: "CHECADOR_RELOJ_BAJA",
      entityType: "ChecadorReloj",
      entityId: serie,
      userId: actorId,
      metadata: { url: reloj.url, nombre: reloj.nombre },
    });
    return { dispositivoSerie: serie };
  }

  /**
   * Configuración del reloj leída en vivo (identidad, hora y personas dadas de
   * alta). Solo lectura: nada de esto se puede cambiar desde aquí.
   */
  async configuracion(serie: string): Promise<ChecadorRelojConfig> {
    const reloj = await this.registrado(serie);
    const client = this.cliente(reloj.url, TIMEOUT_INTERACTIVO_MS);
    const info = await this.conectar(client, reloj.url);
    this.verificarSerie(reloj, info);

    const opcional = <T>(lectura: Promise<T>, que: string): Promise<T | null> =>
      lectura.catch((err: unknown) => {
        logger.warn(`[checador] ${reloj.nombre ?? serie}: no se pudo leer ${que}: ${mensajeDe(err)}`);
        return null;
      });
    const [hora, personas] = await Promise.all([
      opcional(
        client.time().then((t) => ({
          horaLocal: t.localTime,
          modo: t.timeMode,
          zona: t.timeZone,
          // El reloj trunca los segundos: su hora real está en [hora, hora + 1 s),
          // así que se compara contra la mitad. Se mide al recibir la respuesta.
          desfaseSegundos: Math.round((t.instante.getTime() + 500 - Date.now()) / 1000),
        })),
        "la hora"
      ),
      opcional(
        client.userCount().then((c) => ({
          total: c.userNumber,
          conRostro: c.bindFaceUserNumber,
          conHuella: c.bindFingerprintUserNumber,
          conTarjeta: c.bindCardUserNumber,
        })),
        "las personas"
      ),
    ]);

    return {
      dispositivoSerie: serie,
      leidoEn: new Date(),
      dispositivo: {
        nombre: info.deviceName,
        modelo: info.model,
        firmware: info.firmwareVersion,
        mac: info.macAddress,
      },
      hora,
      personas,
    };
  }

  // ── Sincronización (solo lectura de los relojes) ────────────────────────

  /**
   * Importación manual por rango de días (`POST /checador/import`): lee de
   * todos los relojes los eventos de esos días y guarda las checadas que
   * falten. Corre en segundo plano, tarde lo que tarde, y su avance sale en
   * `status()`. Es independiente de la sincronización periódica y del cursor:
   * puede correr a la vez, y los duplicados se descartan por el `@@unique`.
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

    const relojes = await this.relojesParaLeer();
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
    void this.runImport(relojes, importacion, inicio, fin);
    return importacion;
  }

  /**
   * Sincronización periódica: cada `intervalMs` (y al arrancar) lee a los
   * relojes dados de alta. Cada reloj va por su lado: uno lento o caído no
   * detiene a los demás, y uno que rechaza las credenciales se pausa solo él
   * hasta reiniciar la API (o hasta un reintento manual).
   */
  startWorker(intervalMs: number): () => void {
    if (!this.credenciales) {
      logger.info("[checador] sin CHECADOR_USER/CHECADOR_PASS: sincronización deshabilitada");
      return () => undefined;
    }
    const tick = async (): Promise<void> => {
      try {
        for (const reloj of await this.registrados()) {
          const estado = this.estado(reloj.dispositivoSerie);
          if (!estado.enCurso && !estado.pausadoPorCredenciales) void this.run(reloj);
        }
      } catch (err) {
        logger.error(`[checador] no se pudieron leer los relojes dados de alta: ${mensajeDe(err)}`);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(timer);
  }

  /**
   * `POST /checador/sync`: drena de cada reloj **todo lo que falte** desde su
   * cursor, sin esperar al worker. Es la misma corrida que hace el worker y
   * comparte su candado: se arranca en los relojes que no estén corriendo y, si
   * todos lo están, 409. Se permite aunque un reloj esté en pausa por
   * credenciales (es un reintento explícito, de un solo intento; si acierta, la
   * corrida limpia la pausa). Responde 202 y el avance sale en `status()`.
   */
  async sync(): Promise<ChecadorProgreso> {
    const libres = (await this.relojesParaLeer()).filter((r) => !this.estado(r.dispositivoSerie).enCurso);
    if (libres.length === 0) {
      throw new HttpError(409, {
        code: "CHECADOR_SYNC_IN_PROGRESS",
        message: "Ya hay una sincronización en curso; espera a que termine",
      });
    }
    // `run` fija `enCurso` de forma síncrona antes de su primer `await`.
    for (const reloj of libres) void this.run(reloj);
    return this.enCursoTotal()!;
  }

  /** Nunca lanza: el resultado (ok o error) queda en `ultimaCorrida` del reloj. */
  private async run(reloj: RelojRegistrado): Promise<void> {
    const serie = reloj.dispositivoSerie;
    const nombre = reloj.nombre ?? serie;
    const estado = this.estado(serie);
    const progreso: ChecadorProgreso = {
      startedAt: new Date(),
      leidos: 0,
      nuevas: 0,
      restantes: null,
      total: null,
    };
    estado.enCurso = progreso;
    estado.detener = false;
    let confirmado: number | null = null;
    let corrida: ChecadorCorrida;

    try {
      const client = this.cliente(reloj.url);
      this.verificarSerie(reloj, await client.deviceInfo());
      const cursor = await this.db.checadorReloj.findUniqueOrThrow({ where: { dispositivoSerie: serie } });
      confirmado = cursor.ultimoSerialNo;
      const confirmar = async (ultimoSerialNo: number): Promise<void> => {
        await this.db.checadorReloj.update({
          where: { dispositivoSerie: serie },
          data: { ultimoSerialNo, sincronizadoEn: new Date() },
        });
        confirmado = ultimoSerialNo;
      };

      // Hasta dónde leer en esta corrida: todo consecutivo menor ya existe en
      // el reloj, así que al llegar ahí el cursor es exacto. Lo que entre
      // mientras tanto lo lee la siguiente corrida.
      const hasta = await client.ultimoSerialNo(cursor.ultimoSerialNo + 1);
      let ultimoSerialNo = cursor.ultimoSerialNo;
      if (hasta !== null && hasta > cursor.ultimoSerialNo) {
        progreso.total = hasta - cursor.ultimoSerialNo;
        progreso.restantes = progreso.total;
        for (let desde = cursor.ultimoSerialNo + 1; desde <= hasta; desde += VENTANA_SERIAL) {
          const fin = Math.min(desde + VENTANA_SERIAL - 1, hasta);
          for (const minor of MINORS_CHECADA) {
            for await (const { eventos } of client.acsEvents(desde, fin, minor)) {
              if (estado.detener) throw new RelojDadoDeBaja();
              progreso.nuevas += await this.guardar(serie, eventos);
            }
          }
          await confirmar(fin);
          ultimoSerialNo = fin;
          // El avance es en consecutivos (eventos del reloj) revisados.
          progreso.leidos = fin - cursor.ultimoSerialNo;
          progreso.restantes = hasta - fin;
        }
      } else {
        await confirmar(ultimoSerialNo); // nada nuevo: solo queda la hora de la revisión
      }

      estado.pausadoPorCredenciales = false;
      if (progreso.nuevas > 0) {
        logger.info(
          `[checador] ${nombre}: ${progreso.nuevas} checadas nuevas (${progreso.leidos} eventos revisados, consecutivo ${ultimoSerialNo})`
        );
      }
      corrida = {
        ok: true,
        dispositivoSerie: serie,
        startedAt: progreso.startedAt,
        finishedAt: new Date(),
        leidos: progreso.leidos,
        nuevas: progreso.nuevas,
        ultimoSerialNo,
        error: null,
      };
    } catch (err) {
      const error = mensajeDe(err);
      if (err instanceof IsapiAuthError) {
        estado.pausadoPorCredenciales = true;
        logger.error(
          `[checador] ${nombre}: ${error}. Sincronización automática en pausa hasta reiniciar la API, para no bloquear la cuenta en el reloj.`
        );
      } else if (err instanceof RelojDadoDeBaja) {
        logger.info(`[checador] ${nombre}: dado de baja, se detuvo su sincronización`);
      } else {
        logger.error(`[checador] ${nombre}: sincronización fallida: ${error}`);
      }
      corrida = {
        ok: false,
        dispositivoSerie: serie,
        startedAt: progreso.startedAt,
        finishedAt: new Date(),
        leidos: progreso.leidos,
        nuevas: progreso.nuevas,
        ultimoSerialNo: confirmado,
        error,
      };
    } finally {
      estado.enCurso = null;
    }
    estado.ultimaCorrida = corrida;
  }

  /** Nunca lanza: el resultado (o los errores por reloj) queda en la misma `importacion`. */
  private async runImport(
    relojes: RelojRegistrado[],
    importacion: ChecadorImportacion,
    inicio: Date,
    fin: Date
  ): Promise<void> {
    const rango = `${importacion.desde} a ${importacion.hasta}`;
    // Checadas del rango por reloj y método (se conocen con la primera página
    // de cada búsqueda); el total se publica cuando ya se conocen todas.
    const totales = new Map<string, number>();
    const esperados = relojes.length * MINORS_CHECADA.length;
    const fijarTotal = (clave: string, total: number): void => {
      if (totales.has(clave)) return;
      totales.set(clave, total);
      importacion.total =
        totales.size === esperados ? [...totales.values()].reduce((a, n) => a + n, 0) : null;
    };
    const errores: string[] = [];

    await Promise.all(
      relojes.map(async (reloj) => {
        const serie = reloj.dispositivoSerie;
        const nombre = reloj.nombre ?? serie;
        try {
          const client = this.cliente(reloj.url);
          this.verificarSerie(reloj, await client.deviceInfo());
          for (const minor of MINORS_CHECADA) {
            for await (const { totalMatches, eventos } of client.acsEventsBetween(inicio, fin, minor)) {
              fijarTotal(`${serie}/${minor}`, totalMatches);
              importacion.leidos += eventos.length;
              importacion.nuevas += await this.guardar(serie, eventos);
            }
            // Sin checadas de ese método en el rango, la búsqueda no da total.
            fijarTotal(`${serie}/${minor}`, 0);
          }
        } catch (err) {
          const error = mensajeDe(err);
          if (err instanceof IsapiAuthError) this.estado(serie).pausadoPorCredenciales = true;
          errores.push(`${nombre}: ${error}`);
          logger.error(`[checador] importación ${rango} en ${nombre} fallida: ${error}`);
        } finally {
          // Si falló, lo que no alcanzó a reportar cuenta como cero.
          for (const minor of MINORS_CHECADA) fijarTotal(`${serie}/${minor}`, 0);
        }
      })
    );

    importacion.error = errores.length > 0 ? errores.join(" · ") : null;
    importacion.finishedAt = new Date();
    logger.info(
      `[checador] importación ${rango}: ${importacion.nuevas} checadas nuevas (${importacion.leidos} leídas de ${relojes.length} reloj(es))`
    );
  }

  /** Guarda las checadas de una página; devuelve cuántas eran nuevas (sin duplicados). */
  private async guardar(serie: string, eventos: AcsEventInfo[]): Promise<number> {
    // Solo con empleado identificado: una checada sin número no es de nadie.
    const data = eventos
      .filter((e) => e.employeeNoString)
      .map((e) => toChecada(serie, e))
      .filter((c): c is Prisma.ChecadaCreateManyInput => c !== null);
    if (data.length === 0) return 0;
    const { count } = await this.db.checada.createMany({ data, skipDuplicates: true });
    return count;
  }

  // ── Apoyo ───────────────────────────────────────────────────────────────

  private estado(serie: string): EstadoReloj {
    let estado = this.estados.get(serie);
    if (!estado) {
      estado = { enCurso: null, ultimaCorrida: null, pausadoPorCredenciales: false, detener: false };
      this.estados.set(serie, estado);
    }
    return estado;
  }

  /** Suma de las corridas en curso de todos los relojes (`null` si no corre ninguna). */
  private enCursoTotal(): ChecadorProgreso | null {
    const corridas = [...this.estados.values()]
      .map((e) => e.enCurso)
      .filter((p): p is ChecadorProgreso => p !== null);
    if (corridas.length === 0) return null;
    const suma = (campo: "leidos" | "nuevas"): number => corridas.reduce((a, p) => a + p[campo], 0);
    // Un total parcial prometería de menos: solo se da cuando todos lo conocen.
    const sumaConocida = (campo: "total" | "restantes"): number | null =>
      corridas.every((p) => p[campo] != null) ? corridas.reduce((a, p) => a + (p[campo] ?? 0), 0) : null;
    return {
      startedAt: new Date(Math.min(...corridas.map((p) => p.startedAt.getTime()))),
      leidos: suma("leidos"),
      nuevas: suma("nuevas"),
      restantes: sumaConocida("restantes"),
      total: sumaConocida("total"),
    };
  }

  private async estadoDe(relojes: RelojRegistrado[]): Promise<ChecadorDispositivoStatus[]> {
    if (relojes.length === 0) return [];
    const totales = await this.db.checada.groupBy({
      by: ["dispositivoSerie"],
      where: { dispositivoSerie: { in: relojes.map((r) => r.dispositivoSerie) } },
      _count: { _all: true },
      _max: { occurredAt: true },
    });
    const porSerie = new Map(totales.map((t) => [t.dispositivoSerie, t]));
    return relojes.map((r) => {
      const estado = this.estados.get(r.dispositivoSerie);
      const total = porSerie.get(r.dispositivoSerie);
      return {
        dispositivoSerie: r.dispositivoSerie,
        nombre: r.nombre ?? r.dispositivoSerie,
        url: r.url,
        asistencia: r.asistencia,
        modelo: r.modelo,
        ultimoSerialNo: r.ultimoSerialNo,
        sincronizadoEn: r.sincronizadoEn,
        checadas: total?._count._all ?? 0,
        ultimaChecada: total?._max.occurredAt ?? null,
        enCurso: estado?.enCurso ?? null,
        ultimaCorrida: estado?.ultimaCorrida ?? null,
        pausadoPorCredenciales: estado?.pausadoPorCredenciales ?? false,
      };
    });
  }

  private async registrados(): Promise<RelojRegistrado[]> {
    const relojes = await this.db.checadorReloj.findMany({
      where: { url: { not: null } },
      orderBy: [{ nombre: "asc" }, { dispositivoSerie: "asc" }],
    });
    return relojes.filter(estaRegistrado);
  }

  private async registrado(serie: string): Promise<RelojRegistrado> {
    const reloj = await this.db.checadorReloj.findUnique({ where: { dispositivoSerie: serie } });
    if (!estaRegistrado(reloj)) {
      throw new HttpError(404, {
        code: "CHECADOR_RELOJ_NOT_FOUND",
        message: "Ese reloj no está dado de alta",
      });
    }
    return reloj;
  }

  /** Relojes para sincronizar o importar; 503 si no hay credenciales o ninguno dado de alta. */
  private async relojesParaLeer(): Promise<RelojRegistrado[]> {
    this.requireCredenciales();
    const relojes = await this.registrados();
    if (relojes.length === 0) {
      throw new HttpError(503, {
        code: "CHECADOR_NOT_CONFIGURED",
        message: "No hay relojes dados de alta",
      });
    }
    return relojes;
  }

  private requireCredenciales(): ChecadorCredenciales {
    if (!this.credenciales) {
      throw new HttpError(503, {
        code: "CHECADOR_NOT_CONFIGURED",
        message: "La API no tiene el usuario de los relojes (CHECADOR_USER / CHECADOR_PASS)",
      });
    }
    return this.credenciales;
  }

  private cliente(url: string, timeoutMs?: number): IsapiClient {
    const { user, pass } = this.requireCredenciales();
    return new IsapiClient(url, user, pass, timeoutMs);
  }

  /** Identidad del reloj; si no contesta o rechaza las credenciales, 502 con el motivo. */
  private async conectar(client: IsapiClient, url: string): Promise<ChecadorDeviceInfo> {
    try {
      return await client.deviceInfo();
    } catch (err) {
      if (err instanceof IsapiAuthError) {
        throw new HttpError(502, {
          code: "CHECADOR_CREDENCIALES",
          message: `${url} rechazó el usuario y la contraseña (CHECADOR_USER / CHECADOR_PASS)`,
        });
      }
      throw new HttpError(502, { code: "CHECADOR_SIN_CONEXION", message: mensajeDe(err) });
    }
  }

  /** La dirección dada de alta tiene que seguir respondiendo el mismo reloj. */
  private verificarSerie(reloj: RelojRegistrado, info: ChecadorDeviceInfo): void {
    if (info.serialNumber !== reloj.dispositivoSerie) {
      throw new HttpError(409, {
        code: "CHECADOR_RELOJ_CAMBIO",
        message: `${reloj.url} ahora responde otro reloj (serie ${info.serialNumber}): da de baja "${reloj.nombre ?? reloj.dispositivoSerie}" y da de alta el nuevo`,
      });
    }
  }

  private duplicado(reloj: ChecadorReloj): HttpError {
    return new HttpError(409, {
      code: "CHECADOR_RELOJ_DUPLICADO",
      message: `Ese reloj ya está dado de alta como "${reloj.nombre ?? reloj.dispositivoSerie}" (${reloj.url})`,
    });
  }
}
