# =========================
# Builder
# =========================
FROM node:20-bullseye AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm install --no-audit --no-fund

RUN npx prisma generate

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

CMD ["node", "dist/src/index.js"]