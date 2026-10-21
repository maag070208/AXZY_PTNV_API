/**
 * Reglas del padrón de empleados desde los relojes (TIME_CLOCK_SYNC.md §3).
 * Lógica pura, sin base de datos: el servicio lee, llama a `planRoster` y aplica
 * el resultado.
 */

/** Corridas seguidas sin aparecer para pasar a baja pendiente (R10). */
export const ROSTER_GRACE_RUNS = 3;
/** Horas sin aparecer para pasar a baja pendiente (R10); se cumplen las dos. */
export const ROSTER_GRACE_MS = 24 * 60 * 60 * 1000;
/** Caída de personas de una corrida a otra que marca la corrida como sospechosa (R5). */
export const ROSTER_DROP_RATIO = 0.2;

/** Lo que se leyó de un reloj que cuenta, en esta corrida. */
export interface RosterReading {
  clockSerial: string;
  /** La lectura fue completa y válida (R4). */
  ok: boolean;
  /** Números de empleado leídos (solo si `ok`). */
  numbers: string[];
  /** Números que el reloj tenía en su última lectura válida guardada. */
  previousNumbers: string[];
}

/** Estado actual de una persona vinculada a un usuario. */
export interface RosterLink {
  employeeNumber: string;
  userActive: boolean;
  status: "ACTIVO" | "BAJA_PENDIENTE";
  missingRuns: number;
  missingSince: Date | null;
  reappearedAt: Date | null;
}

/** Cambio que hay que aplicar a un vínculo. Solo trae los campos que cambian. */
export interface RosterLinkChange {
  employeeNumber: string;
  status?: "ACTIVO" | "BAJA_PENDIENTE";
  missingRuns?: number;
  missingSince?: Date | null;
  reappearedAt?: Date | null;
  event?: "REMOVAL_PENDING" | "REMOVAL_CANCELLED" | "REAPPEARED";
}

export interface RosterPlan {
  /** Ningún reloj dio una lectura válida: no hay nada que cambiar. */
  noRun: boolean;
  /** Algún reloj cayó más de `ROSTER_DROP_RATIO` (R5): no hay bajas pendientes. */
  suspicious: boolean;
  /** Relojes cuya lectura reemplaza su padrón guardado (los válidos y no sospechosos). */
  replaceClocks: string[];
  /** Pares reloj–persona nuevos en esta corrida. */
  added: number;
  /** Números presentes en algún reloj que no tienen vínculo (estado NUEVO). */
  newNumbers: string[];
  changes: RosterLinkChange[];
}

export const planRoster = (input: {
  now: Date;
  readings: RosterReading[];
  links: RosterLink[];
}): RosterPlan => {
  const { now, readings, links } = input;

  // R5: un reloj que pierde demasiadas personas de una corrida a otra no se
  // confía: su lectura no reemplaza el padrón y bloquea las bajas.
  const dropped = (r: RosterReading): boolean =>
    r.ok &&
    r.previousNumbers.length > 0 &&
    (r.previousNumbers.length - r.numbers.length) / r.previousNumbers.length > ROSTER_DROP_RATIO;
  // La sospecha es por reloj (no se confía en él), pero bloquea las bajas de la corrida.
  const suspicious = readings.some(dropped);
  const trusted = readings.filter((r) => r.ok && !dropped(r));

  if (trusted.length === 0) {
    return { noRun: true, suspicious, replaceClocks: [], added: 0, newNumbers: [], changes: [] };
  }

  // R4: un reloj sin lectura válida conserva lo que ya sabíamos de él; nunca se
  // interpreta como "nadie está".
  const present = new Set<string>();
  for (const r of trusted) r.numbers.forEach((n) => present.add(n));
  for (const r of readings) {
    if (!trusted.includes(r)) r.previousNumbers.forEach((n) => present.add(n));
  }

  const added = trusted.reduce(
    (sum, r) => sum + r.numbers.filter((n) => !r.previousNumbers.includes(n)).length,
    0
  );

  const linked = new Set(links.map((l) => l.employeeNumber));
  const newNumbers = [...present].filter((n) => !linked.has(n)).sort();

  const changes: RosterLinkChange[] = [];
  for (const link of links) {
    if (present.has(link.employeeNumber)) {
      changes.push(...onPresent(link, now));
    } else if (link.userActive && !suspicious) {
      changes.push(...onAbsent(link, now));
    }
  }

  return {
    noRun: false,
    suspicious,
    replaceClocks: trusted.map((r) => r.clockSerial),
    added,
    newNumbers,
    changes: changes.filter((c) => Object.keys(c).length > 1),
  };
};

const onPresent = (link: RosterLink, now: Date): RosterLinkChange[] => {
  const out: RosterLinkChange = { employeeNumber: link.employeeNumber };
  if (link.status === "BAJA_PENDIENTE") {
    // R16: reapareció antes de aplicar la baja: se cancela sin motivo.
    out.status = "ACTIVO";
    out.event = "REMOVAL_CANCELLED";
  }
  if (link.missingRuns > 0) {
    out.missingRuns = 0;
    out.missingSince = null;
  }
  if (!link.userActive && !link.reappearedAt) {
    // R17: ya dado de baja y reapareció: solo se marca para que RH lo vea.
    out.reappearedAt = now;
    out.event = out.event ?? "REAPPEARED";
  }
  if (link.userActive && link.reappearedAt) {
    out.reappearedAt = null;
  }
  return [out];
};

const onAbsent = (link: RosterLink, now: Date): RosterLinkChange[] => {
  const missingRuns = link.missingRuns + 1;
  const missingSince = link.missingSince ?? now;
  const graceMet =
    missingRuns >= ROSTER_GRACE_RUNS && now.getTime() - missingSince.getTime() >= ROSTER_GRACE_MS;
  const out: RosterLinkChange = { employeeNumber: link.employeeNumber, missingRuns, missingSince };
  if (graceMet && link.status === "ACTIVO") {
    // R10–R11: la baja queda pendiente; el usuario sigue activo hasta que RH
    // capture un motivo.
    out.status = "BAJA_PENDIENTE";
    out.event = "REMOVAL_PENDING";
  }
  return [out];
};
