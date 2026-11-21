# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ARG VERSION=0.2.5
LABEL org.opencontainers.image.title="fisle-game" \
      org.opencontainers.image.description="Turn-based hexagonal 3D strategy game inspired by Antiyoy" \
      org.opencontainers.image.source="https://github.com/shtrmx/fisle" \
      org.opencontainers.image.authors="shtrmx" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production
ENV PORT=3000
ENV MAX_ROOMS=100
ENV MAX_ROOMS_PER_PLAYER=3

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.ts"]
