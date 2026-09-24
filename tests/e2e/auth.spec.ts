import bcrypt from "bcryptjs";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertBaseDeDatosSegura, nuevoRunId } from "./support/env";

/**
 * E2E de contrato — sesión actual (`GET /auth/me`). Además del usuario, trae lo
 * que necesita su credencial digital (número, puesto, departamento y foto), que
 * la app muestra al guardia. Los usuarios y el departamento se crean aquí y se
 * borran al final.
 */
assertBaseDeDatosSegura();

const RUN = nuevoRunId();
const DEPTO = `${E2E_PREFIX} Auth ${RUN}`;
const CON_DATOS = `e2e_auth_datos_${RUN}`.toLowerCase();
const SIN_DATOS = `e2e_auth_vacio_${RUN}`.toLowerCase();

const sesionDe = async (username: string): Promise<APIRequestContext> => {
  const login = await playwrightRequest.newContext({ baseURL: E2E.baseURL });
  const res = await login.post("auth/login", { data: { username, password: E2E.password } });
  expect(res.status(), await res.text()).toBe(200);
  const { token } = (await res.json()) as { token: string };
  await login.dispose();
  return playwrightRequest.newContext({
    baseURL: E2E.baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
};

let conDatos: { id: string };
let departamento: { id: string; name: string };

test.beforeAll(async () => {
  const password = await bcrypt.hash(E2E.password, 10);
  departamento = await db.department.create({ data: { name: DEPTO }, select: { id: true, name: true } });
  conDatos = await db.user.create({
    data: {
      username: CON_DATOS,
      name: "E2E Credencial Con Datos",
      role: "EMPLEADO",
      password,
      numeroEmpleado: `${E2E_PREFIX}${RUN}`,
      puesto: "Recepcionista",
      departmentId: departamento.id,
      fotoKey: `e2e/${RUN}/foto.jpg`,
    },
    select: { id: true },
  });
  await db.user.create({
    data: { username: SIN_DATOS, name: "E2E Credencial Sin Datos", role: "JEFE_DE_AREA", password },
  });
});

test.afterAll(async () => {
  await db.user.deleteMany({ where: { username: { in: [CON_DATOS, SIN_DATOS] } } });
  await db.department.deleteMany({ where: { id: departamento.id } });
});

test.describe("Auth — sesión actual (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonimo }) => {
    expect((await ctxAnonimo.get("auth/me")).status()).toBe(401);
  });

  test("trae los datos de la credencial: número, puesto, departamento y foto", async () => {
    const ctx = await sesionDe(CON_DATOS);
    const res = await ctx.get("auth/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      id: conDatos.id,
      username: CON_DATOS,
      name: "E2E Credencial Con Datos",
      role: "EMPLEADO",
      departmentId: departamento.id,
      numeroEmpleado: `${E2E_PREFIX}${RUN}`,
      puesto: "Recepcionista",
      department: { id: departamento.id, name: DEPTO },
      // Mismo contrato que `/access/lookup`: ruta relativa a la base del API.
      fotoUrl: `/personal/${conDatos.id}/foto/raw`,
    });
    await ctx.dispose();
  });

  test("sin esos datos vienen en null", async () => {
    const ctx = await sesionDe(SIN_DATOS);
    const res = await ctx.get("auth/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      username: SIN_DATOS,
      role: "JEFE_DE_AREA",
      numeroEmpleado: null,
      puesto: null,
      department: null,
      fotoUrl: null,
    });
    await ctx.dispose();
  });
});
