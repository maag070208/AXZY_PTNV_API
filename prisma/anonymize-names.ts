/**
 * Reemplaza los nombres REALES de los usuarios por nombres falsos, para poder
 * enseñar el sistema como demo sin exponer a la plantilla.
 *
 * - Toca `name` (y `middleName`/`paternalSurname`/`maternalSurname`) de todos
 *   los usuarios EXCEPTO la data de ejemplo (`demo.*`) y los fixtures de
 *   pruebas (`e2e*`).
 * - También reescribe el `name` guardado en las checadas (`time_clock_punches`)
 *   de cada persona, que es donde aparece en los reportes del reloj.
 * - NO toca `username` ni `email`: el login seguiría funcionando igual. (Ojo:
 *   el username suele llevar la inicial + apellido real; si para la demo
 *   también estorba, hay que cambiarlo aparte.)
 *
 * La asignación es determinista (misma semilla → mismos nombres falsos), así
 * que se puede repetir sin que "cambien de nombre" entre corridas.
 *
 * Uso: npm run anonymize:names
 *
 * Seguridad: solo corre contra una base local.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FIRST_NAMES = [
  "MARÍA FERNANDA", "JUAN CARLOS", "ANA SOFÍA", "LUIS MIGUEL", "CARLA", "DIEGO", "VALERIA", "ANDRÉS",
  "PAOLA", "RICARDO", "DANIELA", "FERNANDO", "ALEJANDRA", "SERGIO", "MONTSERRAT", "EMILIANO",
  "REGINA", "JAVIER", "CAMILA", "RODRIGO", "XIMENA", "MATEO", "RENEÉ", "SEBASTIÁN",
  "MARIANA", "LEONARDO", "VALENTINA", "EMILIO", "ISABELLA", "GAEL", "SOFÍA", "SANTIAGO",
  "ROMINA", "DAMIÁN", "LUCÍA", "BRUNO", "JIMENA", "ÁNGEL", "FATIMA", "IVÁN",
  "ANDREA", "CRISTIAN", "MELISSA", "ÓSCAR", "NATALIA", "EDGAR", "ABIGAIL", "MOISÉS",
];

const SURNAMES = [
  "GARCÍA", "HERNÁNDEZ", "MARTÍNEZ", "LÓPEZ", "GONZÁLEZ", "PÉREZ", "RODRÍGUEZ", "SÁNCHEZ",
  "RAMÍREZ", "CRUZ", "FLORES", "GÓMEZ", "MORALES", "VÁZQUEZ", "REYES", "JIMÉNEZ",
  "TORRES", "DÍAZ", "MENDOZA", "RUIZ", "AGUILAR", "ORTIZ", "MORENO", "CHÁVEZ",
  "RIVERA", "JUÁREZ", "DOMÍNGUEZ", "GUZMÁN", "VELÁZQUEZ", "SANTIAGO", "ESTRADA", "CORTÉS",
  "LUNA", "VARGAS", "CASTILLO", "CONTRERAS", "NAVARRO", "SALAZAR", "CAMPOS", "GUERRERO",
  "MEDINA", "DELGADO", "ROJAS", "CARDENAS", "SOTO", "VEGA", "RIVAS", "MIRANDA",
];

let seed = 20261104;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|::1/.test(url) && !process.env.E2E_ALLOW_REMOTE_DB) {
    throw new Error("anonymize:names only runs against a local database (DATABASE_URL)");
  }
}

async function main() {
  assertLocalDatabase();

  const users = await prisma.user.findMany({
    where: { username: { not: { startsWith: "demo." } }, NOT: { username: { startsWith: "e2e" } } },
    select: {
      id: true,
      username: true,
      timeClockEmployees: { select: { employeeNumber: true } },
    },
    orderBy: { username: "asc" },
  });

  let updated = 0;
  let punches = 0;
  for (const user of users) {
    const first = pick(FIRST_NAMES);
    const paternal = pick(SURNAMES);
    const maternal = pick(SURNAMES);
    const fullName = `${first} ${paternal} ${maternal}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { name: fullName, middleName: null, paternalSurname: paternal, maternalSurname: maternal },
    });
    updated += 1;

    for (const link of user.timeClockEmployees) {
      const result = await prisma.timeClockPunch.updateMany({
        where: { employeeNumber: link.employeeNumber },
        data: { name: fullName },
      });
      punches += result.count;
    }
  }

  console.log(`Listo: ${updated} usuarios anonimizados y ${punches} checadas actualizadas.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
