# Переменные окружения

## Базовые настройки

### HTTP Server
```env
HTTP_ADDR=127.0.0.1:8080
```

### gRPC (Xray)
```env
GRPC_ADDR=127.0.0.1:10085
```

### Xray Configuration
```env
CONFIG_PATH=/usr/local/etc/xray/config.json
X_DEFAULT_FLOW=xtls-rprx-vision
X_IN_TAG=vless-inbound
X_PUBLIC_HOST=your-server-ip-or-domain
```

### API Security
```env
API_TOKEN=your-secure-api-token
```

### CORS
```env
CORS_ORIGIN=https://your-frontend-domain.com
```

## База данных

### MongoDB
```env
MONGO_URI=mongodb://localhost:27017/xray-provisioner
```

## Аутентификация

### JWT
```env
JWT_SECRET=your-very-secure-jwt-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

### Telegram Bot
```env
# Токен бота от @BotFather
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Username бота (без @)
BOT_USERNAME=vpnbot

# URL Telegram Mini App (опционально)
TELEGRAM_MINI_APP_URL=https://t.me/your_bot/app

# Секретный ключ для регистрации через бота (минимум 32 символа)
BOT_REGISTRATION_SECRET=your-secure-bot-registration-secret-min-32-chars
```

## Лимиты пользователей

```env
# Максимальное количество аккаунтов на одного пользователя
MAX_ACCOUNTS_PER_USER=5

# Срок действия аккаунта по умолчанию (в днях)
DEFAULT_ACCOUNT_EXPIRY_DAYS=30
```

## Триал и подписки

```env
# Длительность пробного периода (в часах)
TRIAL_PERIOD_HOURS=3

# Лимит трафика для пробного периода (в MB)
TRIAL_TRAFFIC_LIMIT_MB=100

# Процент использования трафика для предупреждения
TRIAL_TRAFFIC_WARNING_PERCENT=80

# Длительность месячной подписки (в днях)
SUBSCRIPTION_MONTHLY_DAYS=30
```

## Реферальная система

```env
# Бонус трафика за каждого приглашенного пользователя (в MB)
REFERRAL_BONUS_TRAFFIC_MB=50

# Бонусные дни подписки за каждого приглашенного пользователя
REFERRAL_BONUS_DAYS=0

# Тип бонуса: traffic | days | both
# traffic - только трафик
# days - только дни подписки  
# both - и трафик, и дни
REFERRAL_BONUS_TYPE=traffic
```

## Примеры конфигурации

### Минимальная конфигурация (для разработки)

```env
HTTP_ADDR=127.0.0.1:8080
GRPC_ADDR=127.0.0.1:10085
MONGO_URI=mongodb://localhost:27017/xray-provisioner

JWT_SECRET=my-super-secret-jwt-key-for-development-only-min-32-chars
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
BOT_USERNAME=vpnbot
BOT_REGISTRATION_SECRET=my-bot-secret-for-development-only-min-32-chars

TRIAL_PERIOD_HOURS=3
TRIAL_TRAFFIC_LIMIT_MB=100
REFERRAL_BONUS_TRAFFIC_MB=50
REFERRAL_BONUS_TYPE=traffic
```

### Продакшн конфигурация

```env
HTTP_ADDR=0.0.0.0:8080
GRPC_ADDR=127.0.0.1:10085
CONFIG_PATH=/usr/local/etc/xray/config.json
X_DEFAULT_FLOW=xtls-rprx-vision
X_IN_TAG=vless-inbound
X_PUBLIC_HOST=vpn.example.com
CORS_ORIGIN=https://app.example.com

MONGO_URI=mongodb://username:password@mongodb:27017/xray-provisioner?authSource=admin

JWT_SECRET=generate-strong-random-key-here-min-64-chars-recommended
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

BOT_TOKEN=your-real-bot-token-from-botfather
BOT_USERNAME=your_vpn_bot
TELEGRAM_MINI_APP_URL=https://t.me/your_vpn_bot/app
BOT_REGISTRATION_SECRET=generate-strong-random-secret-here-min-64-chars

MAX_ACCOUNTS_PER_USER=5
DEFAULT_ACCOUNT_EXPIRY_DAYS=30

TRIAL_PERIOD_HOURS=3
TRIAL_TRAFFIC_LIMIT_MB=100
TRIAL_TRAFFIC_WARNING_PERCENT=80
SUBSCRIPTION_MONTHLY_DAYS=30

REFERRAL_BONUS_TRAFFIC_MB=50
REFERRAL_BONUS_DAYS=0
REFERRAL_BONUS_TYPE=traffic
```

### Конфигурация с бонусом дней за рефералов

```env
# ... остальные переменные ...

# За каждого реферала давать 1 день бонусной подписки
REFERRAL_BONUS_DAYS=1
REFERRAL_BONUS_TYPE=days
```

### Конфигурация с комбинированными бонусами

```env
# ... остальные переменные ...

# За каждого реферала давать и трафик, и дни
REFERRAL_BONUS_TRAFFIC_MB=100
REFERRAL_BONUS_DAYS=3
REFERRAL_BONUS_TYPE=both
```

## Генерация секретных ключей

Для генерации безопасных секретных ключей используйте:

### Linux/Mac
```bash
# JWT Secret
openssl rand -base64 64

# Bot Registration Secret
openssl rand -base64 64
```

### Node.js
```javascript
// JWT Secret
require('crypto').randomBytes(64).toString('base64')

// Bot Registration Secret
require('crypto').randomBytes(64).toString('base64')
```

### Python
```python
import secrets
import base64

# JWT Secret
base64.b64encode(secrets.token_bytes(64)).decode()

# Bot Registration Secret
base64.b64encode(secrets.token_bytes(64)).decode()
```

## Проверка конфигурации

После настройки переменных окружения, убедитесь что:

1. **JWT_SECRET** - минимум 32 символа, уникальный для каждого окружения
2. **BOT_TOKEN** - валидный токен от @BotFather
3. **BOT_USERNAME** - соответствует вашему боту (без @)
4. **BOT_REGISTRATION_SECRET** - минимум 32 символа, никогда не передавайте клиенту
5. **MONGO_URI** - правильный URL подключения к MongoDB
6. **X_PUBLIC_HOST** - публичный IP или домен вашего сервера

## Безопасность

⚠️ **Важно:**
- Никогда не коммитьте `.env` файл в git
- Используйте разные секретные ключи для разработки и продакшена
- Регулярно обновляйте секретные ключи
- Храните бэкапы `.env` файлов в безопасном месте
- Используйте менеджер секретов (Vault, AWS Secrets Manager) в продакшене

