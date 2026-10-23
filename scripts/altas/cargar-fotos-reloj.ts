/**
 * Carga como FOTO DE PERFIL la foto de rostro que cada persona tiene en el reloj.
 * Solo LEE del reloj (consulta de rostro y descarga de la foto); escribe la foto en el
 * almacenamiento del sistema igual que "subir foto" desde la ficha del empleado.
 * No pisa fotos que ya existan (a menos que agregues --reemplazar).
 *
 * Por defecto NO escribe nada (dry-run: cuenta quienes tienen foto en el reloj).
 *
 * Uso (desde api/, con DATABASE_URL y las credenciales del reloj en .env):
 *   npx ts-node -r tsconfig-paths/register scripts/altas/cargar-fotos-reloj.ts [--clock <serie>] [--apply] [--reemplazar]
 * Sin --clock prueba con cada reloj que tenga direccion, en orden, hasta encontrar la foto.
 */
import { prismaClient } from "@core/config/database";
import { env } from "@core/config/env.config";
import { EmployeeDocumentService } from "@modules/hr/services/employee-document.service";
import { IsapiClient } from "@modules/time-clock/services/isapi.client";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const replace = args.includes("--reemplazar");
  const clockArg = args.includes("--clock") ? args[args.indexOf("--clock") + 1] : undefined;
  if (!env.TIME_CLOCK_USER) throw new Error("Falta TIME_CLOCK_USER / TIME_CLOCK_PASS en el .env");

  const clocks = await prismaClient.timeClock.findMany({
    where: { url: { not: null }, ...(clockArg ? { serialNumber: clockArg } : {}) },
    select: { serialNumber: true, name: true, url: true },
  });
  if (clocks.length === 0) throw new Error("No hay relojes con direccion para leer las fotos");
  const clients = clocks.map((c) => ({ name: c.name ?? c.serialNumber, client: new IsapiClient(c.url as string, env.TIME_CLOCK_USER, env.TIME_CLOCK_PASS, 15_000) }));

  const links = await prismaClient.timeClockEmployee.findMany({
    select: { employeeNumber: true, user: { select: { id: true, username: true, photoKey: true } } },
  });
  const pending = links.filter((l) => replace || !l.user.photoKey);
  console.log(apply ? "MODO APLICAR" : "DRY-RUN (no se escribio nada; agrega --apply)");
  console.log(`personas vinculadas: ${links.length} | sin foto de perfil: ${pending.length}`);

  const service = new EmployeeDocumentService(prismaClient);
  let withFace = 0, loaded = 0, noFace = 0, failed = 0;
  for (const link of pending) {
    let photo: Buffer | null = null;
    for (const { client } of clients) {
      try {
        const faces = await client.faceRecords(link.employeeNumber);
        if (faces[0]) { photo = await client.photo(faces[0].faceURL); break; }
      } catch { /* este reloj no responde: se prueba el siguiente */ }
    }
    if (!photo) { noFace++; continue; }
    withFace++;
    if (!apply) continue;
    try {
      await service.uploadPhoto(link.user.id, {
        buffer: photo, mimetype: "image/jpeg", originalname: `reloj-${link.employeeNumber}.jpg`, size: photo.length,
      } as Express.Multer.File);
      loaded++;
    } catch (e) {
      failed++;
      console.error(`  fallo ${link.user.username}: ${(e as Error).message}`);
    }
  }
  console.log(`con foto en el reloj: ${withFace} | sin rostro en el reloj: ${noFace}`);
  if (apply) console.log(`cargadas: ${loaded} | fallidas: ${failed}`);
  if (apply && loaded > 0) {
    await prismaClient.auditLog.create({
      data: { action: "USER_PHOTO_LOADED_FROM_CLOCK", entityType: "User", entityId: "bulk", userName: "script cargar-fotos-reloj", metadata: { cargadas: loaded, fallidas: failed, relojes: clocks.map((c) => c.serialNumber) } },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
