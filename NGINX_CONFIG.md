# Nginx конфигурация для VPN Provisioner API

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        nginx                                │
│                                                             │
│  /health, /info, /api/create-stars-invoice, ...            │
│         ↓                                                   │
│    VPN Bot (порт 3001)                                     │
│                                                             │
│  /xray/health, /xray/auth/*, /xray/bot/*, ...              │
│         ↓                                                   │
│    VPN Provisioner API (порт 8080)                         │
│                                                             │
│  /api/* (остальное)                                         │
│         ↓                                                   │
│    NestJS (порт 3000)                                       │
└─────────────────────────────────────────────────────────────┘
```

## Endpoints VPN Provisioner API

Все endpoints идут через префикс `/xray/`:

| Внешний путь | Внутренний путь | Описание |
|--------------|-----------------|----------|
| `/xray/health` | `/health` | Health check |
| `/xray/auth/*` | `/auth/*` | Авторизация (Telegram, JWT) |
| `/xray/bot/*` | `/bot/*` | Bot API (для Telegram бота) |
| `/xray/webhook/*` | `/webhook/*` | Payment webhooks |
| `/xray/api/accounts/*` | `/api/accounts/*` | Управление VPN аккаунтами |
| `/xray/api/subscription/*` | `/api/subscription/*` | Управление подписками |

## Установка

1. Скопируйте `vpn-api.conf` в nginx snippets:
```bash
sudo cp vpn-api.conf /etc/nginx/snippets/vpn-api.conf
```

2. Добавьте в `/etc/nginx/sites-available/anoname.ru`:
```nginx
# ===== VPN Provisioner API =====
include /etc/nginx/snippets/vpn-api.conf;
```

3. Проверьте и перезагрузите:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Порядок include в конфиге

```nginx
server {
    server_name anoname.ru;
    
    # 1. VPN Bot (порт 3001) - /health, /info, /api/create-stars-invoice, etc.
    include /etc/nginx/snippets/vpn-bot.conf;
    
    # 2. VPN Provisioner API (порт 8080) - /xray/*
    include /etc/nginx/snippets/vpn-api.conf;
    
    # 3. NestJS API (порт 3000) - остальное /api/*
    location /api/ {
        proxy_pass http://localhost:3000/;
        ...
    }
    
    # 4. Frontend
    location / {
        ...
    }
}
```

## Тестирование

```bash
# Health check VPN Provisioner API
curl https://anoname.ru/xray/health

# Health check VPN Bot (как раньше)
curl https://anoname.ru/health

# Bot API (для Telegram бота)
curl -H "x-bot-secret: YOUR_SECRET" \
  https://anoname.ru/xray/bot/check-user/123456789

# Регистрация пользователя
curl -X POST https://anoname.ru/xray/auth/bot-register \
  -H "Content-Type: application/json" \
  -H "x-bot-secret: YOUR_SECRET" \
  -d '{"telegramId": "123456789"}'

# Получить данные пользователя
curl -H "x-bot-secret: YOUR_SECRET" \
  https://anoname.ru/xray/bot/user/123456789

# Получить подписку
curl -H "x-bot-secret: YOUR_SECRET" \
  https://anoname.ru/xray/bot/user/123456789/subscription
```

## Конфигурация VPN Bot

VPN Bot (порт 3001) должен использовать URL с префиксом `/xray/`:

```env
# .env для VPN Bot
BACKEND_API_URL=https://anoname.ru/xray
# или для локального доступа
BACKEND_API_URL=http://127.0.0.1:8080
```

## Переменные окружения VPN Provisioner API

```env
HTTP_ADDR=127.0.0.1:8080
BOT_REGISTRATION_SECRET=your_secret_here
TRUST_PROXY=127.0.0.1
```
