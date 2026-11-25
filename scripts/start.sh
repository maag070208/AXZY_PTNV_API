#!/bin/sh
# Arranque de producción: respalda ANTES de migrar (solo si hay migraciones
# pendientes), migra y arranca la API. Si el respaldo falla NO se migra.
set -eu

# Válvula de emergencia: BACKUP_PRE_MIGRATE=skip migra sin respaldo previo (p. ej.
# si pg_dump no es compatible con el servidor). Solo usarla a propósito.
if [ "${BACKUP_PRE_MIGRATE:-}" = "skip" ]; then
  echo "[start] WARNING: BACKUP_PRE_MIGRATE=skip; migrating WITHOUT a pre-migrate backup." >&2
elif status_out=$(npx prisma migrate status 2>&1); then
  echo "[start] No pending migrations; skipping pre-migrate backup."
else
  # `migrate status` sale distinto de 0 con migraciones pendientes (o base
  # nueva/fallida). En la duda se respalda: es el lado seguro.
  echo "$status_out" | tail -n 12
  echo "[start] Pending migrations detected; backing up before migrating..."
  if ! node dist/src/core/backup/cli.js pre-migrate; then
    echo "[start] ERROR: pre-migrate backup failed; NOT applying migrations. Set BACKUP_PRE_MIGRATE=skip only to bypass on purpose." >&2
    exit 1
  fi
fi

npx prisma migrate deploy
exec node dist/src/index.js
