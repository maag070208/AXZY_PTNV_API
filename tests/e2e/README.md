# Suite E2E de inventario (Playwright)

Pruebas **reales** contra la API corriendo en local: cada test hace peticiones
HTTP de verdad a `http://localhost:4001/api/v1`, que escribe en la base Postgres
de verdad. No hay mocks, ni stubs, ni base en memoria.

Cubre los cuatro flujos del ciclo de vida de un dispositivo, contra la
especificación funcional de [`DISPOSITIVOS.md`](../../../DISPOSITIVOS.md):

| Archivo | Flujo | Secciones del doc |
|---|---|---|
| `alta.spec.ts` | ALTA de tipos, dispositivos y unidades | §4, §5 |
| `prestamos.spec.ts` | PRÉSTAMOS, devoluciones, cancelación y edición | §8–§14, §21, §22 |
| `mantenimiento.spec.ts` | MOVIMIENTOS DE MANTENIMIENTO y reversión | §7, §23–§25 |
| `baja.spec.ts` | BAJA | §15–§17, §24 |
| `ciclo-completo.spec.ts` | El recorrido completo encadenado | §26, §28 |

## Cómo correrlas

```bash
cd api
npm test
```

Si la API no está levantada, Playwright la arranca con `npm run dev` y espera al
health check; si ya está corriendo, la reutiliza. Postgres sí tiene que estar
arriba (`docker compose up -d postgres` desde la raíz).

```bash
npm test -- prestamos.spec.ts        # un solo flujo
npm test -- -g "devoluciones"        # por nombre
npm run test:e2e:ui                  # modo interactivo
npm run test:e2e:report              # abrir el último reporte HTML
```

## Cómo están armadas

**Aislamiento.** Cada test crea su propio `TipoDispositivo` con un `code` y
`folioPrefix` únicos que empiezan con `E2E`, y da de alta sus propios
dispositivos encima. Ningún test toca los datos reales del cliente que viven en
la base, y los folios arrancan siempre en `-0001`, así que las aserciones sobre
consecutivos son deterministas.

**Limpieza.** `support/global-teardown.ts` borra todo lo que produjo la corrida
—resolviendo el alcance desde ese prefijo `E2E` y respetando el orden de llaves
foráneas— así que la base queda como estaba. El `global-setup` repite la
limpieza al arrancar, por si una corrida anterior se cortó a la mitad.

**Usuarios.** El seed viene del respaldo del cliente y no trae contraseñas
conocidas, así que el setup provisiona dos usuarios propios de forma idempotente:
`e2e_admin` (ADMIN) y `e2e_empleado` (EMPLEADO, para verificar los 403). La
contraseña sale de `E2E_PASSWORD` y por defecto es `e2e-Test-2026!`. Estos dos
usuarios sobreviven entre corridas a propósito.

**Doble verificación.** Las aserciones van contra la respuesta HTTP y, donde la
API no expone el dato, contra la base por Prisma: estado de cada unidad física,
`devuelto` de un detalle de préstamo, `status` de un movimiento, qué unidad
quedó ligada a qué préstamo.

**Serie, no paralelo.** `workers: 1` es deliberado: el consecutivo de préstamo se
calcula con `count() + 1` dentro de una transacción Serializable, así que dos
préstamos concurrentes chocan. El test
`prestamos.spec.ts › varios préstamos simultáneos…` cubre esa concurrencia a
propósito y verifica el invariante que sí debe cumplirse siempre: ninguna unidad
se asigna dos veces y no se pierde ni se inventa inventario.

## Seguridad

La suite escribe y borra filas. `support/env.ts` se niega a correr si
`DATABASE_URL` no apunta a un host local, salvo que exportes
`E2E_ALLOW_REMOTE_DB=1`, y nunca corre con `NODE_ENV=production`.

## Variables de entorno

Se leen del mismo `api/.env` que usa el servidor.

| Variable | Default | Para qué |
|---|---|---|
| `E2E_API_URL` | `http://localhost:${PORT}/api/v1` | Apuntar a otra instancia |
| `E2E_PASSWORD` | `e2e-Test-2026!` | Contraseña de los usuarios de prueba |
| `E2E_ALLOW_REMOTE_DB` | — | `1` para permitir una base no local |
