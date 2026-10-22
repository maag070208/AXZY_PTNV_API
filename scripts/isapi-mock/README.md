# Mock ISAPI (pruebas locales)

Simula un reloj Hikvision en memoria, solo en `127.0.0.1`. **No toca ningún reloj real.**

## Levantar el mock

```bash
cd api && npx ts-node scripts/isapi-mock/server.ts      # puerto 4801 (MOCK_PORT)
```

- Usuario y contraseña: `mock` / `mock-pass-123` (`MOCK_USER`, `MOCK_PASS`).
- `GET  /__mock__/state` muestra personas, tarjetas y eventos (sin contraseñas).
- `POST /__mock__/reset` vuelve al estado inicial (8 personas, 1 tarjeta, 48 eventos).

## Probar el cliente del sistema contra el mock

```bash
cd api && npx ts-node -r tsconfig-paths/register scripts/isapi-mock/smoke.ts
```

Solo acepta `127.0.0.1`. Lee identidad, hora, conteo, padrón completo y eventos.

## Usar el mock desde la API local

Para que la API local use el mock, pon las credenciales del mock como variables de entorno al arrancarla (no en `.env`):

```bash
TIME_CLOCK_USER=mock TIME_CLOCK_PASS=mock-pass-123 npm run dev
```

Luego da de alta el reloj desde la web con la dirección `http://127.0.0.1:4801`.

**Cuidado:** esa instancia usa las mismas credenciales para todos los relojes. No la uses con relojes reales.

## Qué imita y qué no

- Imita: `deviceInfo`, `System/time`, `UserInfo` (Count, Search, Record, Modify, Delete), `CardInfo` (capabilities, Count, Search, SetUp, Delete) y `AcsEvent` (búsqueda con paginación).
- No imita todavía: huellas, rostros, fotos ni eventos en vivo.
- Diferencia conocida: `Delete` de una persona que no existe responde OK. El reloj real puede responder error. Verificar con el probe antes de confiar en eso.
