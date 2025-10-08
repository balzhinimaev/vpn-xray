# syntax=docker/dockerfile:1.7


# --- deps stage: install deps once ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
# Если есть lockfile -> npm ci, иначе npm i
RUN npm ci --no-audit --no-fund || (echo "[warn] No lockfile, falling back to npm install" && npm i)


# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# --- runtime stage ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app


# (Опционально) добавить небольшие утилиты и init-процесс
RUN apk add --no-cache tini ca-certificates wget


# (Опционально) Включить xray CLI внутри контейнера для вычисления pbk из privateKey.
# В большинстве случаев проще передать pbk через переменную окружения X_PBK.
# Чтобы собрать контейнер с CLI, задайте build-аргумент WITH_XRAY=1 (см. compose).
ARG WITH_XRAY=0
ARG XRAY_VERSION=1.8.11
RUN if [ "$WITH_XRAY" = "1" ]; then \
    apk add --no-cache curl unzip && \
    XRAY_URL="https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" && \
    echo "[info] Downloading xray from $XRAY_URL" && \
    curl -fsSL "$XRAY_URL" -o /tmp/xray.zip && \
    unzip -j /tmp/xray.zip xray -d /usr/local/bin && \
    chmod +x /usr/local/bin/xray && \
    rm -f /tmp/xray.zip; \
    fi


# Создадим непривилегированного пользователя
RUN addgroup -g 10001 -S app && adduser -S -D -H -u 10001 app -G app


# Копируем артефакты
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist


# Конфиг Xray монтируем снаружи на /usr/local/etc/xray/config.json (read-only)


USER app
EXPOSE 8080


# Healthcheck пингует /health через локальный интерфейс контейнера
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/health || exit 1


ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/index.js"]