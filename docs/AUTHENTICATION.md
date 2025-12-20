# Авторизация в API

В этом API есть несколько способов авторизации в зависимости от типа клиента и маршрута.

## 1. JWT авторизация (для пользователей через Telegram Mini App)

Это основной способ авторизации для пользователей. Используется для маршрутов `/auth/*` и `/api/*`.

### Шаг 1: Авторизация через Telegram initData

**Endpoint:** `POST /auth/telegram`

Отправьте `initData` из Telegram Web App для получения JWT токенов.

**Запрос:**
```bash
curl -X POST http://localhost:8080/auth/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "initData": "user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22John%22%7D&auth_date=1234567890&hash=..."
  }'
```

**Ответ:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j0",
    "telegramId": "123456789",
    "username": "john_doe",
    "firstName": "John",
    "lastName": "Doe",
    "isPremium": false
  }
}
```

### Шаг 2: Использование Access Token

После получения токенов используйте `accessToken` для доступа к защищенным маршрутам.

**Запрос:**
```bash
curl -X GET http://localhost:8080/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Обновление токенов

**Endpoint:** `POST /auth/refresh`

Используйте `refreshToken` для получения новой пары токенов (когда `accessToken` истекает).

**Запрос:**
```bash
curl -X POST http://localhost:8080/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Ответ:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Выход

**Endpoint:** `POST /auth/logout`

Удаляет сессию пользователя.

**Запрос:**
```bash
curl -X POST http://localhost:8080/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 2. API Token авторизация (Legacy API)

Используется для административных маршрутов `/users` и `/info`. Настраивается через переменную окружения `API_TOKEN`.

**Формат:** `Authorization: Bearer {API_TOKEN}`

**Пример:**
```bash
export API_TOKEN="your-secret-api-token"

# Получить информацию о inbound
curl -X GET http://localhost:8080/info \
  -H "Authorization: Bearer $API_TOKEN"

# Создать пользователя
curl -X POST http://localhost:8080/users \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "remark": "test user",
    "flow": "xtls-rprx-vision"
  }'

# Получить статистику трафика
curl -X GET "http://localhost:8080/users/user_1234567890@app/traffic?reset=false" \
  -H "Authorization: Bearer $API_TOKEN"

# Удалить пользователя
curl -X DELETE "http://localhost:8080/users/user_1234567890@app" \
  -H "Authorization: Bearer $API_TOKEN"
```

**Важно:** Если `API_TOKEN` не установлен в `.env`, эти маршруты будут доступны без авторизации (только для разработки).

## 3. Bot Secret авторизация (для Telegram бота)

Используется для маршрутов `/bot/*`. Настраивается через переменную окружения `BOT_REGISTRATION_SECRET`.

**Способы передачи:**

1. В заголовке `x-bot-secret`:
```bash
curl -X GET "http://localhost:8080/bot/check-user/123456789" \
  -H "x-bot-secret: your-bot-secret"
```

2. В query параметре `secret`:
```bash
curl -X GET "http://localhost:8080/bot/check-user/123456789?secret=your-bot-secret"
```

3. В теле запроса (для POST):
```bash
curl -X POST "http://localhost:8080/bot/user/123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-bot-secret"
  }'
```

## 4. Регистрация через бота (автоматическая)

**Endpoint:** `POST /auth/bot-register`

Используется ботом для автоматической регистрации пользователей. Требует `BOT_REGISTRATION_SECRET`.

**Запрос:**
```bash
curl -X POST http://localhost:8080/auth/bot-register \
  -H "Content-Type: application/json" \
  -H "x-bot-secret: your-bot-secret" \
  -d '{
    "telegramId": "123456789",
    "username": "john_doe",
    "firstName": "John",
    "lastName": "Doe",
    "languageCode": "ru",
    "isPremium": false,
    "referralCode": "ABC123"
  }'
```

**Ответ:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j0",
    "telegramId": "123456789",
    "username": "john_doe",
    "firstName": "John",
    "lastName": "Doe",
    "subscriptionStatus": "trial",
    "trialEndsAt": "2024-01-01T12:00:00.000Z",
    "referralCode": "XYZ789"
  },
  "vlessAccount": {
    "id": "account-id",
    "uuid": "uuid-here",
    "email": "user_1234567890@app",
    "link": "vless://..."
  }
}
```

## Маршруты, требующие авторизации

### JWT авторизация (Bearer token)
- `/api/accounts/*` - управление VPN аккаунтами
- `/api/subscription/*` - управление подписками
- `/auth/me` - информация о текущем пользователе
- `/auth/logout` - выход

### API Token авторизация (Bearer token)
- `/users/*` - управление пользователями (legacy API)
- `/info` - информация о конфигурации inbound

### Bot Secret авторизация
- `/bot/*` - все маршруты бота

### Без авторизации
- `/health` - проверка здоровья сервера
- `/auth/telegram` - авторизация через Telegram (требует initData)
- `/auth/refresh` - обновление токенов (требует refreshToken)
- `/auth/bot-register` - регистрация через бота (требует bot secret)

## Настройка переменных окружения

Убедитесь, что в файле `.env` настроены следующие переменные:

```env
# JWT авторизация
JWT_SECRET=your-secret-key-min-32-characters-long
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# API Token (legacy)
API_TOKEN=your-api-token

# Telegram Bot
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
BOT_REGISTRATION_SECRET=your-bot-registration-secret

# CORS (опционально)
CORS_ORIGIN=https://your-frontend.com,https://your-telegram-app.com
```

## Пример использования в JavaScript/TypeScript

### Авторизация через Telegram Mini App

```javascript
// Получение initData из Telegram Web App
const initData = window.Telegram.WebApp.initData;

// Авторизация
const response = await fetch('http://localhost:8080/auth/telegram', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ initData })
});

const { accessToken, refreshToken, user } = await response.json();

// Сохранение токенов
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);

// Использование токена для запросов
const apiResponse = await fetch('http://localhost:8080/api/accounts', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

### Обновление токенов

```javascript
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  
  const response = await fetch('http://localhost:8080/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken })
  });
  
  if (response.ok) {
    const { accessToken, refreshToken: newRefreshToken } = await response.json();
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', newRefreshToken);
    return accessToken;
  } else {
    // Токен истек, требуется повторная авторизация
    throw new Error('Token refresh failed');
  }
}
```

## Безопасность

1. **JWT токены:**
   - `accessToken` имеет короткий срок жизни (по умолчанию 15 минут)
   - `refreshToken` имеет длительный срок жизни (по умолчанию 7 дней)
   - Храните токены безопасно (не в localStorage для критичных приложений)

2. **API Token:**
   - Используйте сильный случайный токен
   - Никогда не коммитьте токен в Git
   - Ротация токенов при компрометации

3. **Bot Secret:**
   - Используйте отдельный секрет для каждого окружения
   - Храните в переменных окружения

4. **HTTPS:**
   - Всегда используйте HTTPS в production
   - Настройте правильные CORS политики

