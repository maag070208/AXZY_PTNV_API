# syntax=docker/dockerfile:1

# =========================
# Builder
# =========================
FROM node:20-bullseye AS builder

WORKDIR /app

# Dependencias primero: `prisma/` y `src/` NO invalidan esta capa (antes
# `COPY prisma` iba antes del install y cualquier migración re-instalaba todo).
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund

# Esquema de Prisma y cliente generado.
COPY prisma ./prisma
RUN npx prisma generate

# Código y compilación.
COPY tsconfig.json ./
COPY src ./src

RUN npm run build


# =========================
# Runtime
# =========================
FROM node:20-bullseye-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

EXPOSE 4001

# Boot de producción: aplica pendientes de migración y arranca. El seed NO corre
# aquí (la base del cliente ya está sembrada); es manual vía `npm run seed` o
# el `cutover` de conversión.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
