````md
# xray-provisioner

Микро‑сервис (Node/TypeScript), который через gRPC API Xray выполняет «горячее» добавление/удаление пользователей VLESS (HandlerService.AlterInbound c AddUserOperation/RemoveUserOperation) и отдаёт готовые VLESS‑ссылки (REALITY / TLS+WS / TLS+TCP).

## Требования

- Ubuntu 24.04 LTS
- Xray установлен и работает как systemd-сервис `xray`
- `config.json` лежит в `/usr/local/etc/xray/config.json`
- gRPC API Xray включён и доступен только локально: `api.listen = "127.0.0.1:10085"`, сервисы: HandlerService, StatsService, LoggerService.
- В конфиге есть минимум один inbound `vless` (по умолчанию `security: "reality"`, поддерживаются также `security: "tls"` и `network: ws/tcp`).

## Установка (Node 20)

```bash
sudo apt-get update
# Node 20 (через NodeSource или nvm). Пример с NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Развёртывание
sudo mkdir -p /opt/xray-provisioner
sudo chown "$USER":"$USER" /opt/xray-provisioner
cd /opt/xray-provisioner
# Скопируйте файлы репозитория сюда (см. этот README)

npm ci
npm run build
cp .env.example .env
# отредактируйте .env (HTTP_ADDR, API_TOKEN, X_PUBLIC_HOST, X_IN_TAG и т.д.)

# Запуск вручную
npm start
# или через systemd (см. systemd/xray-provisioner.service)
sudo cp systemd/xray-provisioner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xray-provisioner
````

### Альтернатива: Docker

```bash
# В переменных окружения задайте X_PUBLIC_HOST, API_TOKEN и пр.
docker build -t xray-provisioner:latest .
# Linux: удобнее host network, чтобы достучаться до 127.0.0.1:10085 на хосте
docker run --name xray-provisioner --network host \
  -e HTTP_ADDR=0.0.0.0:8080 \
  -e GRPC_ADDR=127.0.0.1:10085 \
  -e X_PUBLIC_HOST=example.com \
  -e API_TOKEN=change-me \
  -v /usr/local/etc/xray/config.json:/usr/local/etc/xray/config.json:ro \
  -d xray-provisioner:latest
```

## Конфигурация через `.env`

* `HTTP_ADDR` — адрес HTTP сервера (по умолчанию `127.0.0.1:8080`).
* `API_TOKEN` — если задан, все защищённые эндпоинты требуют `Authorization: Bearer <token>`.
* `GRPC_ADDR` — адрес gRPC Xray (`127.0.0.1:10085`). **Не открывайте наружу!**
* `X_IN_TAG` — inbound tag. Если не задан, сервис сам найдёт первый `protocol: vless` в `config.json`.
* `X_PUBLIC_HOST` — домен/IP для VLESS ссылок. Если не задан, сервис попытается взять первый внешний IPv4 интерфейса. Если не получилось — вернёт 400.
* `X_DEFAULT_FLOW` — flow по умолчанию (например, `xtls-rprx-vision`). Можно переопределить в теле запроса.
* `X_PBK` — публичный ключ (pbk) для REALITY, если нельзя вычислить из `privateKey`.
* `CORS_ORIGIN` — включить CORS только для указанных Origin (список через запятую). По умолчанию CORS выключен.

## Поведение

* UUID генерируется через `uuidv4()`.
* Email по умолчанию: `user_<timestamp>@app`.
* Flow по умолчанию: `xtls-rprx-vision` (можно задать в `.env` или теле POST `/users`).
* Remark — опциональное поле ответа; в Xray хранится только `email`.
* Ссылки `vless://` корректно собираются для `security=reality` (tcp), `security=tls` + `ws` (path/host), `security=tls` + `tcp`.
* Для REALITY pbk вычисляется из `privateKey` через `xray x25519 -i <privateKey>`. Если не удалось — используется `X_PBK`. Если обоих нет — ошибка.
* Stats читаются строго по именам `user>>>EMAIL>>>traffic>>>downlink/uplink`. `reset=true` сбрасывает соответствующие счётчики.

## Эндпоинты

> Все, кроме `/health`, защищены Bearer‑токеном при наличии `API_TOKEN`.

* `GET /health` → `{ ok: true }`.
* `GET /info` → сводка по выбранному inbound: `{ inboundTag, port, security, network, sni, pbk, path, hostHeader, publicHost }`.
* `POST /users` → добавляет пользователя.

  * Тело (JSON): `{ email?, flow?, remark? }`
  * Ответ: `{ uuid, email, inboundTag, port, security, link, raw }`, где `link` — готовая VLESS‑ссылка, `raw` — детали (sni/host/pbk/flow/type/path и т.д.).
* `DELETE /users/:email` → удаляет пользователя по email.
* `GET /users/:email/traffic?reset=false` → возвращает байты `{ uplink, downlink }`. При `reset=true` counters сбрасываются.

### Примеры `curl`

```bash
# Удобно экспортировать токен
export API_TOKEN="change-me-please"

# Добавить пользователя
curl -sS -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8080/users \
  -d '{"remark":"tester","flow":"xtls-rprx-vision"}' | jq .

# Трафик пользователя
curl -sS -H "Authorization: Bearer $API_TOKEN" \
  "http://127.0.0.1:8080/users/user_1720000000000@app/traffic?reset=false" | jq .

# Удалить пользователя
curl -sS -H "Authorization: Bearer $API_TOKEN" \
  -X DELETE "http://127.0.0.1:8080/users/user_1720000000000@app" | jq .

# Здоровье
curl -sS http://127.0.0.1:8080/health | jq .
# Инфо
curl -sS -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:8080/info | jq .
```

## Проверка gRPC доступности

Проверьте, что API отвечает локально (пример из Xray CLI):

```bash
xray api statssys --server=127.0.0.1:10085
```

Если включён server reflection, можно использовать `grpcurl`:

```bash
grpcurl -plaintext 127.0.0.1:10085 list
```

## Безопасность

* gRPC порт **НЕ ДОЛЖЕН** быть доступен снаружи. Оставляйте `127.0.0.1:10085`.
* REST сервис по умолчанию слушает `127.0.0.1:8080`. Отдавайте наружу через Nginx (TLS, Basic‑auth по желанию).

### Пример Nginx (reverse proxy + Basic‑auth)

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  # Basic-auth (создать файл: htpasswd -c /etc/nginx/.htpasswd admin)
  auth_basic           "Restricted";
  auth_basic_user_file /etc/nginx/.htpasswd;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
  }
}
```

## Варианты интеграции с gRPC

* **Вариант A (по умолчанию)** — готовый TypeScript SDK `@remnawave/xtls-sdk`. Инициализация в коде:

  ```ts
  import { XtlsApi } from '@remnawave/xtls-sdk';
  const api = new XtlsApi('127.0.0.1', '10085');
  await api.handler.addVlessUser({ tag: inboundTag, username: email, uuid, flow, level: 0 });
  await api.handler.removeUser(inboundTag, email);
  const stats = await api.stats.getUserStats(email, /* reset */ false);
  ```

* **Вариант B (fallback)** — без SDK: динамическая загрузка .proto и упаковка `TypedMessage` вручную. Скрипты:

  ```bash
  npm run proto:fetch   # скачает нужные .proto из Xray-core
  npm run proto:gen     # (опционально) сгенерирует js/ts stubs
  ```

  В `src/index.ts` уже есть реализация упаковки `AddUserOperation`/`RemoveUserOperation` и вызов `HandlerService.AlterInbound`, а также `StatsService.GetStats` по именам `user>>>EMAIL>>>traffic>>>uplink/downlink`.

## Частые вопросы

* **Нет pbk для REALITY.** Если в `streamSettings.realitySettings` отсутствует `privateKey`, задайте `X_PBK` в `.env`.
* **Не тот inbound.** Укажите `X_IN_TAG` (строго по тегу). Иначе берётся первый `protocol: vless` из `config.json`.
* **X_PUBLIC_HOST пуст.** Сервис попробует взять первый внешний IPv4. Если его нет (VPS без публичного IPv4 или контейнер) — вернёт 400.
* **Flow.** По умолчанию `xtls-rprx-vision`. Для WS обычно `flow` не нужен — можно пустым.

## Лицензия

MIT

````

---

```