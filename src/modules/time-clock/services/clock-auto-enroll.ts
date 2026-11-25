/** Resultado por reloj del alta automática (mismo contrato que `employeeClockAltaAll`). */
export interface ClockSyncResults {
  results: Array<{ serial: string; name: string; ok: boolean; code?: string }>;
}

/** Tope de espera del alta automática: el alta de usuario no debe quedarse esperando a los relojes. */
export const AUTO_ENROLL_TIMEOUT_MS = 25_000;

/**
 * Decide si un usuario recién creado se da de alta en los relojes: debe tener
 * número de empleado y ser personal (mismo universo que Personal).
 */
export const shouldAutoEnroll = (
  user: { role: string; employeeNumber?: string | null },
  staffRoles: string[]
): boolean => !!user.employeeNumber?.trim() && staffRoles.includes(user.role);

/**
 * Corre el alta con un tope de tiempo y NUNCA lanza: si falla o tarda de más,
 * devuelve un resultado de error para que la creación del usuario siga intacta.
 */
export const runAutoEnroll = async (
  run: () => Promise<ClockSyncResults>,
  timeoutMs: number = AUTO_ENROLL_TIMEOUT_MS
): Promise<ClockSyncResults> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<ClockSyncResults>((resolve) => {
      timer = setTimeout(
        () => resolve({ results: [{ serial: "", name: "", ok: false, code: "TIME_CLOCK_TIMEOUT" }] }),
        timeoutMs
      );
    });
    return await Promise.race([run(), timeout]);
  } catch {
    return { results: [{ serial: "", name: "", ok: false, code: "UNKNOWN" }] };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
