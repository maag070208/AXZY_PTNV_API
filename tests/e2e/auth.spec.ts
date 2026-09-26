import bcrypt from "bcryptjs";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E, E2E_PREFIX, assertSafeDatabase, newRunId } from "./support/env";

/**
 * E2E de contrato — sesión actual (`GET /auth/me`). Además del usuario, trae lo
 * que necesita su credencial digital (número, puesto, departamento y foto), que
 * la app muestra al guardia. Los usuarios y el departamento se crean aquí y se
 * borran al final.
 */
assertSafeDatabase();

const RUN = newRunId();
const DEPT = `${E2E_PREFIX} Auth ${RUN}`;
const WITH_DATA = `e2e_auth_datos_${RUN}`.toLowerCase();
const WITHOUT_DATA = `e2e_auth_vacio_${RUN}`.toLowerCase();

const sessionOf = async (username: string): Promise<APIRequestContext> => {
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

let withData: { id: string };
let department: { id: string; name: string };

test.beforeAll(async () => {
  const password = await bcrypt.hash(E2E.password, 10);
  department = await db.department.create({ data: { name: DEPT }, select: { id: true, name: true } });
  withData = await db.user.create({
    data: {
      username: WITH_DATA,
      name: "E2E Credencial Con Datos",
      role: "EMPLOYEE",
      password,
      employeeNumber: `${E2E_PREFIX}${RUN}`,
      jobTitle: "Recepcionista",
      departmentId: department.id,
      photoKey: `e2e/${RUN}/foto.jpg`,
    },
    select: { id: true },
  });
  await db.user.create({
    data: { username: WITHOUT_DATA, name: "E2E Credencial Sin Datos", role: "AREA_HEAD", password },
  });
});

test.afterAll(async () => {
  await db.user.deleteMany({ where: { username: { in: [WITH_DATA, WITHOUT_DATA] } } });
  await db.department.deleteMany({ where: { id: department.id } });
});

test.describe("Auth — sesión actual (E2E)", () => {
  test("sin token es 401", async ({ ctxAnonymous }) => {
    expect((await ctxAnonymous.get("auth/me")).status()).toBe(401);
  });

  test("trae los datos de la credencial: número, puesto, departamento y foto", async () => {
    const ctx = await sessionOf(WITH_DATA);
    const res = await ctx.get("auth/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      id: withData.id,
      username: WITH_DATA,
      name: "E2E Credencial Con Datos",
      role: "EMPLOYEE",
      departmentId: department.id,
      employeeNumber: `${E2E_PREFIX}${RUN}`,
      jobTitle: "Recepcionista",
      department: { id: department.id, name: DEPT },
      // Mismo contrato que `/access/lookup`: ruta relativa a la base del API.
      photoUrl: `/hr/${withData.id}/photo/raw`,
    });
    await ctx.dispose();
  });

  test("sin esos datos vienen en null", async () => {
    const ctx = await sessionOf(WITHOUT_DATA);
    const res = await ctx.get("auth/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      username: WITHOUT_DATA,
      role: "AREA_HEAD",
      employeeNumber: null,
      jobTitle: null,
      department: null,
      photoUrl: null,
    });
    await ctx.dispose();
  });
});
