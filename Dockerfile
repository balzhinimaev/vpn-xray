# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm ci --no-audit --no-fund || (echo "No lockfile, falling back to install" && npm i)
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# --- runtime stage ---
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 10001 -S app && adduser -S -D -H -u 10001 app -G app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Конфиг Xray монтируется read-only на /usr/local/etc/xray/config.json
USER app
EXPOSE 8080
CMD ["node", "dist/index.js"]