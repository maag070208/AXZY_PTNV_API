import { systemPayrollNumber } from "@modules/users/services/employee-sync-rules";

/** Estado de una persona del reloj frente al sistema. */
export type SystemStatus = "LINKED" | "MATCH" | "NONE";

export interface SystemPersonRef {
  status: SystemStatus;
  userId?: string;
  userName?: string;
}

export interface SystemUserRef {
  id: string;
  name: string;
  employeeNumber: string | null;
}

export interface SystemUserIndex {
  byExact: Map<string, SystemUserRef[]>;
  byPayroll: Map<number, SystemUserRef[]>;
}

const push = <K>(map: Map<K, SystemUserRef[]>, key: K, user: SystemUserRef) => {
  const list = map.get(key);
  if (list) list.push(user);
  else map.set(key, [user]);
};

/** Indexa los usuarios una sola vez (por número literal y por número de nómina sin prefijo de área). */
export const buildSystemUserIndex = (users: SystemUserRef[]): SystemUserIndex => {
  const index: SystemUserIndex = { byExact: new Map(), byPayroll: new Map() };
  for (const user of users) {
    if (!user.employeeNumber) continue;
    push(index.byExact, user.employeeNumber, user);
    const payroll = systemPayrollNumber(user.employeeNumber);
    if (payroll !== null) push(index.byPayroll, payroll, user);
  }
  return index;
};

/**
 * Clasifica un número del reloj:
 * - LINKED: ya tiene vínculo activo (`link`).
 * - MATCH: sin vínculo y exactamente UN usuario con el mismo número (literal) o,
 *   si no hay literal, con el mismo número de nómina (sin prefijo de área).
 * - NONE: sin candidatos o con varios (ambiguo).
 */
export const classifySystemStatus = (
  clockNumber: string,
  link: { userId: string; userName: string } | null,
  index: SystemUserIndex
): SystemPersonRef => {
  if (link) return { status: "LINKED", userId: link.userId, userName: link.userName };
  const exact = index.byExact.get(clockNumber) ?? [];
  const payroll = systemPayrollNumber(clockNumber);
  const candidates = exact.length > 0 ? exact : payroll !== null ? (index.byPayroll.get(payroll) ?? []) : [];
  if (candidates.length === 1) return { status: "MATCH", userId: candidates[0].id, userName: candidates[0].name };
  return { status: "NONE" };
};
