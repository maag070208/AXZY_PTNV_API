import { test as base, expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { E2E, E2E_PREFIX, nuevoRunId } from "./env";
import { db } from "./db";
import { InventarioApi, type Dispositivo, type TipoDispositivo } from "./inventario-api";

/** Identificador único de este proceso de worker, para folios sin colisión. */
const RUN_ID = nuevoRunId();
let secuencia = 0;

const contextoAutenticado = async (username: string | null): Promise<APIRequestContext> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (username) {
    const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
    const res = await login.post("auth/login", {
      data: { username, password: E2E.password },
    });
    if (res.status() !== 200) {
      throw new Error(
        `No se pudo autenticar a "${username}" (${res.status()}). ¿Corrió el global setup? → ${await res.text()}`
      );
    }
    const { token } = (await res.json()) as { token: string };
    await login.dispose();
    headers.Authorization = `Bearer ${token}`;
  }

  return playwrightRequest.newContext({ baseURL: E2E.baseURL, extraHTTPHeaders: headers });
};

/**
 * Un tipo de dispositivo recién creado, propio del test, con fábrica de
 * dispositivos encima. Aísla cada test: los folios arrancan en -0001 y las
 * existencias no las mueve nadie más.
 */
export class Escenario {
  constructor(
    readonly api: InventarioApi,
    readonly tipo: TipoDispositivo
  ) {}

  /** Alta de un dispositivo con `cantidad` unidades disponibles. */
  async dispositivo(
    cantidad: number,
    extra: Partial<Parameters<InventarioApi["crearDispositivo"]>[0]> = {}
  ): Promise<Dispositivo> {
    secuencia += 1;
    return this.api.crearDispositivo({
      tipoId: this.tipo.id,
      nombre: `Equipo ${RUN_ID}-${secuencia}`,
      marca: "MarcaPrueba",
      modelo: "ModeloPrueba",
      cantidadInicial: cantidad,
      ...extra,
    });
  }
}

interface Fixtures {
  /** API de inventario autenticada como ADMIN. */
  inv: InventarioApi;
  /** Misma API como EMPLEADO: sirve para verificar los 403. */
  invEmpleado: InventarioApi;
  /** Misma API sin token: sirve para verificar los 401. */
  invAnonimo: InventarioApi;
  /** Tipo de dispositivo exclusivo del test + fábrica de dispositivos. */
  escenario: Escenario;
  /** Un departamento real de la base, para asignar préstamos. */
  departamentoId: string;
  /** Sitio demo provisionado para la suite del módulo `access`. */
  sitioDemoId: string;
}

interface WorkerFixtures {
  ctxAdmin: APIRequestContext;
  ctxEmpleado: APIRequestContext;
  ctxGuard: APIRequestContext;
  ctxAnonimo: APIRequestContext;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  ctxAdmin: [
    async ({}, use) => {
      const ctx = await contextoAutenticado(E2E.admin.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxEmpleado: [
    async ({}, use) => {
      const ctx = await contextoAutenticado(E2E.empleado.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxGuard: [
    async ({}, use) => {
      const ctx = await contextoAutenticado(E2E.guard.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxAnonimo: [
    async ({}, use) => {
      const ctx = await contextoAutenticado(null);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  inv: async ({ ctxAdmin }, use) => {
    await use(new InventarioApi(ctxAdmin));
  },

  invEmpleado: async ({ ctxEmpleado }, use) => {
    await use(new InventarioApi(ctxEmpleado));
  },

  invAnonimo: async ({ ctxAnonimo }, use) => {
    await use(new InventarioApi(ctxAnonimo));
  },

  escenario: async ({ inv }, use) => {
    secuencia += 1;
    const marca = `${E2E_PREFIX}${RUN_ID}${String(secuencia).padStart(3, "0")}`;
    const tipo = await inv.crearTipo({
      code: marca,
      name: `Tipo de prueba ${marca}`,
      folioPrefix: marca,
    });
    await use(new Escenario(inv, tipo));
  },

  departamentoId: async ({}, use) => {
    const depto = await db.department.findFirst({ select: { id: true } });
    if (!depto) throw new Error("No hay departamentos en la base; el seed no corrió");
    await use(depto.id);
  },

  sitioDemoId: async ({}, use) => {
    const site = await db.site.findUnique({ where: { code: E2E.demoSite.code } });
    if (!site) throw new Error("El sitio demo E2E no está provisionado (¿corrió globalSetup?)");
    await use(site.id);
  },
});

export { expect };
export type { Dispositivo, TipoDispositivo };
