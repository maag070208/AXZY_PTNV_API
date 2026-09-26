import { test as base, expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { E2E, E2E_PREFIX, newRunId } from "./env";
import { db } from "./db";
import { InventoryApi, type Device, type DeviceType } from "./inventory-api";

/** Identificador único de este proceso de worker, para folios sin colisión. */
const RUN_ID = newRunId();
let sequence = 0;

const contextAuthenticated = async (username: string | null): Promise<APIRequestContext> => {
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
export class Scenario {
  constructor(
    readonly api: InventoryApi,
    readonly type: DeviceType
  ) {}

  /** Alta de un dispositivo con `cantidad` unidades disponibles. */
  async device(
    quantity: number,
    extra: Partial<Parameters<InventoryApi["createDevice"]>[0]> = {}
  ): Promise<Device> {
    sequence += 1;
    return this.api.createDevice({
      typeId: this.type.id,
      name: `Equipo ${RUN_ID}-${sequence}`,
      brand: "TestBrand",
      model: "TestModel",
      initialQuantity: quantity,
      ...extra,
    });
  }
}

interface Fixtures {
  /** API de inventario autenticada como ADMIN. */
  inv: InventoryApi;
  /** Misma API como EMPLEADO: sirve para verificar los 403. */
  invEmployee: InventoryApi;
  /** Misma API sin token: sirve para verificar los 401. */
  invAnonymous: InventoryApi;
  /** Tipo de dispositivo exclusivo del test + fábrica de dispositivos. */
  scenario: Scenario;
  /** Un departamento real de la base, para asignar préstamos. */
  departmentId: string;
  /** Sitio demo provisionado para la suite del módulo `access`. */
  siteDemoId: string;
}

interface WorkerFixtures {
  ctxAdmin: APIRequestContext;
  ctxEmployee: APIRequestContext;
  ctxGuard: APIRequestContext;
  ctxAnonymous: APIRequestContext;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  ctxAdmin: [
    async ({}, use) => {
      const ctx = await contextAuthenticated(E2E.admin.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxEmployee: [
    async ({}, use) => {
      const ctx = await contextAuthenticated(E2E.employee.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxGuard: [
    async ({}, use) => {
      const ctx = await contextAuthenticated(E2E.guard.username);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  ctxAnonymous: [
    async ({}, use) => {
      const ctx = await contextAuthenticated(null);
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  inv: async ({ ctxAdmin }, use) => {
    await use(new InventoryApi(ctxAdmin));
  },

  invEmployee: async ({ ctxEmployee }, use) => {
    await use(new InventoryApi(ctxEmployee));
  },

  invAnonymous: async ({ ctxAnonymous }, use) => {
    await use(new InventoryApi(ctxAnonymous));
  },

  scenario: async ({ inv }, use) => {
    sequence += 1;
    const brand = `${E2E_PREFIX}${RUN_ID}${String(sequence).padStart(3, "0")}`;
    const type = await inv.createType({
      code: brand,
      name: `Tipo de prueba ${brand}`,
      assetTagPrefix: brand,
    });
    await use(new Scenario(inv, type));
  },

  departmentId: async ({}, use) => {
    const dept = await db.department.findFirst({ select: { id: true } });
    if (!dept) throw new Error("No hay departamentos en la base; el seed no corrió");
    await use(dept.id);
  },

  siteDemoId: async ({}, use) => {
    const site = await db.site.findUnique({ where: { code: E2E.demoSite.code } });
    if (!site) throw new Error("El sitio demo E2E no está provisionado (¿corrió globalSetup?)");
    await use(site.id);
  },
});

export { expect };
export type { Device, DeviceType };
