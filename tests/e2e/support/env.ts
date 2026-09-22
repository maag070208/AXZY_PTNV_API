import path from "node:path";
import dotenv from "dotenv";

// Los tests corren contra la API real; reutilizamos el mismo .env que usa el
// servidor para no duplicar configuración (DATABASE_URL, PORT).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = process.env.PORT ?? "4001";

/**
 * Todo lo que crea la suite lleva este prefijo en el `code`/`folioPrefix` del
 * tipo de dispositivo. El teardown borra exactamente por ahí, así que los datos
 * reales del cliente que ya viven en la base nunca se tocan.
 */
export const E2E_PREFIX = "E2E";

const API_URL = process.env.E2E_API_URL ?? `http://localhost:${PORT}/api/v1`;

export const E2E = {
  apiUrl: API_URL,
  /** Con barra final: las rutas de los tests son relativas a /api/v1/. */
  baseURL: `${API_URL.replace(/\/+$/, "")}/`,
  healthUrl: `${API_URL.replace(/\/+$/, "")}/health`,
  prefix: E2E_PREFIX,
  password: process.env.E2E_PASSWORD ?? "e2e-Test-2026!",
  admin: { username: "e2e_admin", name: "E2E Admin", role: "ADMIN" as const },
  empleado: { username: "e2e_empleado", name: "E2E Empleado", role: "EMPLEADO" as const },
};

/**
 * La suite escribe y borra filas reales. Cortamos de tajo si la DATABASE_URL no
 * apunta a una base local, salvo que se pida explícitamente lo contrario.
 */
export const assertBaseDeDatosSegura = (): void => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida (revisa api/.env)");
  if (process.env.E2E_ALLOW_REMOTE_DB === "1") return;

  const host = new URL(url).hostname;
  const esLocal = ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host);
  if (!esLocal) {
    throw new Error(
      `Los tests E2E escriben y borran datos: se esperaba una base local y DATABASE_URL apunta a "${host}". ` +
        `Si es intencional, exporta E2E_ALLOW_REMOTE_DB=1.`
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("No se ejecutan los tests E2E con NODE_ENV=production");
  }
};

/** Sufijo único por corrida, para que los folios y nombres nunca choquen. */
export const nuevoRunId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
