# syntax=docker/dockerfile:1

# =========================
# Builder
# =========================
FROM node:20-bullseye AS builder

WORKDIR /app

# pnpm (con la caché de npm para no re-descargarlo) + dependencias desde el
# lockfile: reproducible y más rápido que un `npm install` sin lock.
RUN --mount=type=cache,target=/root/.npm npm install -g pnpm@10

# Dependencias primero: `prisma/` y `src/` NO invalidan esta capa (antes
# `COPY prisma` iba antes del install y cualquier migración re-instalaba todo).
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# Esquema de Prisma y cliente generado (los binarios se cachean entre builds).
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.cache/prisma pnpm exec prisma generate

# Código y compilación.
COPY tsconfig.json ./
COPY src ./src

RUN pnpm run build


# =========================
# Runtime
# =========================
FROM node:20-bullseye-slim AS runtime

ENV NODE_ENV=production
ENV BACKUP_DIR=/app/backups
WORKDIR /app

# pg_dump 16 (igual que el Postgres del compose) desde PGDG: el de Debian
# bullseye es la 13 y se niega a respaldar un servidor 16. PGDG ya movió
# bullseye a apt-archive.postgresql.org.
# Bullseye ya es EOL: sus paquetes salieron de deb.debian.org (404), así que se
# apunta a archive.debian.org (índices caducados, de ahí Check-Valid-Until).
RUN sed -i -E 's#https?://(deb|security)\.debian\.org#http://archive.debian.org#g' /etc/apt/sources.list \
    && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99archive \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt-archive.postgresql.org/pub/repos/apt bullseye-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY scripts/start.sh ./scripts/start.sh

# Respaldos automáticos (pg_dump): mapear un volumen con nombre aquí en el compose.
RUN mkdir -p /app/backups
VOLUME ["/app/backups"]

EXPOSE 4001

# Boot de producción: aplica pendientes de migración y arranca. El seed NO corre
# aquí (la base del cliente ya está sembrada); es manual vía `npm run seed` o
# el `cutover` de conversión.
# Antes de migrar, el script respalda la base si hay migraciones pendientes.
CMD ["sh", "scripts/start.sh"]
