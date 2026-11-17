/**
 * Lógica pura de jornadas y línea de tiempo de checadas (sin base de datos).
 * Se separa del servicio para poder probarla con pruebas unitarias.
 */

/** Ventana por defecto (min) de checadas repetidas cuando no hay configuración. */
export const DEFAULT_DUPLICATE_MINUTES = 2;
export const MAX_DUPLICATE_MINUTES = 30;
export const DUPLICATE_MINUTES_CONFIG_KEY = "TIME_CLOCK_DUPLICATE_MINUTES";

/**
 * Tope de una jornada: la salida es la última checada antes de que pase esto
 * desde la entrada; si no hay ninguna, la entrada queda sin salida. En los
 * relojes las jornadas duran 3–13 h y los descansos 13–16 h; ver TIME_CLOCK.md §6.
 */
export const MAX_WORKDAY_MS = 13 * 60 * 60 * 1000;

const MS_PER_MINUTE = 60 * 1000;

/** Entero de minutos entre 0 y 30; un valor inválido cae al default. */
export const resolveDuplicateMs = (raw: string | null | undefined): number => {
  const n = raw === null || raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  const minutes = Number.isFinite(n) ? Math.min(MAX_DUPLICATE_MINUTES, Math.max(0, Math.round(n))) : DEFAULT_DUPLICATE_MINUTES;
  return minutes * MS_PER_MINUTE;
};

/** Quita las checadas repetidas: las que llegan antes de `duplicateMs` de la última que se quedó. */
export const withoutDuplicates = (instants: Date[], duplicateMs: number): Date[] => {
  const unique: Date[] = [];
  for (const t of instants) {
    const previous = unique[unique.length - 1];
    if (previous && t.getTime() - previous.getTime() < duplicateMs) continue;
    unique.push(t);
  }
  return unique;
};

export interface Outing {
  exitAt: Date;
  /** `null` = salió y no hay regreso registrado. */
  returnAt: Date | null;
}

export interface Jornada {
  entryAt: Date;
  /** Última checada de la jornada (null si solo hay la entrada). */
  exitAt: Date | null;
  /** Todas las checadas de la jornada sin repetidas, en orden. */
  punches: Date[];
  outings: Outing[];
  /** Suma de (regreso - salida) de las salidas completas. Solo informativo. */
  awayMinutes: number;
  /** Cantidad impar de checadas intermedias: la última salida no tiene regreso. */
  incompleteSequence: boolean;
  /** Dentro del tope de 13 h y (sin salida, o la última checada fue entrada/regreso). */
  onSite: boolean;
  incident: "OPEN_ENTRY" | "ENTRY_WITHOUT_EXIT" | null;
}

/**
 * Arma las jornadas a partir de las checadas ya ordenadas. La primera checada
 * es la entrada y la última antes del tope es la salida; las de en medio
 * alternan salida, regreso, salida, regreso… solo por orden.
 */
export const buildTimeline = (
  instants: Date[],
  duplicateMs: number,
  nowMs: number = Date.now()
): Jornada[] => {
  const all = withoutDuplicates(instants, duplicateMs);
  const jornadas: Jornada[] = [];
  for (let i = 0; i < all.length; ) {
    const entryAt = all[i];
    const cap = entryAt.getTime() + MAX_WORKDAY_MS;
    let last = i;
    while (last + 1 < all.length && all[last + 1].getTime() <= cap) last += 1;

    const punches = all.slice(i, last + 1);
    const withinCap = nowMs < cap;
    const middle = punches.slice(1, -1);
    const outings: Outing[] = [];
    for (let k = 0; k < middle.length; k += 2) {
      outings.push({ exitAt: middle[k], returnAt: middle[k + 1] ?? null });
    }
    const awayMs = outings.reduce(
      (acc, o) => (o.returnAt ? acc + (o.returnAt.getTime() - o.exitAt.getTime()) : acc),
      0
    );
    const single = punches.length === 1;
    jornadas.push({
      entryAt,
      exitAt: single ? null : punches[punches.length - 1],
      punches,
      outings,
      awayMinutes: Math.round(awayMs / MS_PER_MINUTE),
      // Mientras la jornada sigue abierta, un número impar solo significa que ya regresó.
      incompleteSequence: !withinCap && middle.length % 2 === 1,
      onSite: withinCap && (single || punches.length % 2 === 1),
      incident: single ? (withinCap ? "OPEN_ENTRY" : "ENTRY_WITHOUT_EXIT") : null,
    });
    i = last + 1;
  }
  return jornadas;
};
