import { test, expect } from "./support/fixtures";
import { db } from "./support/db";
import { E2E } from "./support/env";

/**
 * REPORTE de dispositivos — `/reports/devices` y `/reports/asignados`.
 *
 * La web condiciona responsable/depto/días/folio a `estado === "ASIGNADO"`,
 * pero el inventario guarda la unidad como `PRESTADO`. El service normaliza
 * `PRESTADO → ASIGNADO`; aquí se verifica que el reporte salga ya normalizado
 * y con los campos de asignación poblados.
 */

interface DeviceReportRow {
  deviceId: string;
  controlActivos: string;
  descripcion: string;
  tipo: string;
  marca: string;
  modelo: string;
  estado: string;
  responsable: string | null;
  numeroEmpleado: string | null;
  departamento: string | null;
  diasAsignado: number | null;
  folio: string | null;
}

interface AsignadoRow {
  deviceId: string;
  controlActivos: string;
  descripcion: string;
  responsable: string;
  departamento: string | null;
  diasAsignado: number | null;
  folio: string | null;
}

const msPerDay = 1000 * 60 * 60 * 24;

test.describe("REPORTES — dispositivos", () => {
  test("el reporte de devices normaliza PRESTADO→ASIGNADO y puebla los campos", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    // Unidad de control: sigue DISPONIBLE, sus campos de asignación van null.
    const dispositivoDisponible = await escenario.dispositivo(1);
    const [unidadDisponible] = await inv.unidades(dispositivoDisponible.id);

    // Unidad prestada con responsable + departamento.
    const dispositivoPrestado = await escenario.dispositivo(1);
    const [unidadPrestada] = await inv.unidades(dispositivoPrestado.id);
    const admin = await db.user.findUniqueOrThrow({
      where: { username: E2E.admin.username },
    });
    const depto = await db.department.findUniqueOrThrow({
      where: { id: departamentoId },
    });

    const { prestamo } = await inv.prestar({
      responsableId: admin.id,
      departamentoId,
      detalles: [{ dispositivoId: dispositivoPrestado.id, cantidad: 1 }],
    });

    // Envejecemos el préstamo para que los días reportados sean estables y
    // superen el umbral de alerta (>30) sin depender del reloj.
    await db.prestamo.update({
      where: { id: prestamo.id },
      data: { fecha: new Date(Date.now() - 40 * msPerDay) },
    });

    const res = await inv.get<{ data: DeviceReportRow[]; total: number }>("/reports/devices");
    expect(res.status).toBe(200);

    const prestada = res.body.data.find((r) => r.controlActivos === unidadPrestada.activoFijo);
    expect(prestada).toBeDefined();
    expect(prestada).toMatchObject({
      estado: "ASIGNADO",
      responsable: admin.name,
      departamento: depto.name,
      folio: prestamo.consecutivo,
    });
    expect(prestada!.numeroEmpleado).toBe(admin.numeroEmpleado);
    expect(prestada!.diasAsignado).toBeGreaterThanOrEqual(40);

    // Caso negativo: la unidad disponible no trae asignación.
    const disponible = res.body.data.find((r) => r.controlActivos === unidadDisponible.activoFijo);
    expect(disponible).toBeDefined();
    expect(disponible).toMatchObject({
      estado: "DISPONIBLE",
      responsable: null,
      departamento: null,
      folio: null,
      diasAsignado: null,
    });
  });

  test("/reports/asignados lista la misma unidad con responsable, depto y folio", async ({
    inv,
    escenario,
    departamentoId,
  }) => {
    const dispositivo = await escenario.dispositivo(1);
    const [unidad] = await inv.unidades(dispositivo.id);
    const admin = await db.user.findUniqueOrThrow({
      where: { username: E2E.admin.username },
    });
    const depto = await db.department.findUniqueOrThrow({
      where: { id: departamentoId },
    });

    const { prestamo } = await inv.prestar({
      responsableId: admin.id,
      departamentoId,
      detalles: [{ dispositivoId: dispositivo.id, cantidad: 1 }],
    });

    const res = await inv.get<{ data: AsignadoRow[]; total: number }>("/reports/asignados");
    expect(res.status).toBe(200);

    const fila = res.body.data.find((r) => r.controlActivos === unidad.activoFijo);
    expect(fila).toBeDefined();
    expect(fila).toMatchObject({
      responsable: admin.name,
      departamento: depto.name,
      folio: prestamo.consecutivo,
    });
    expect(fila!.diasAsignado).toBeGreaterThanOrEqual(0);
  });

  test("sin token, el reporte responde 401", async ({ invAnonimo }) => {
    expect((await invAnonimo.get("/reports/devices")).status).toBe(401);
    expect((await invAnonimo.get("/reports/asignados")).status).toBe(401);
  });
});