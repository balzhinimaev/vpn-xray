# Bot API Routes

Эти маршруты предназначены для использования телеграм ботом для получения данных пользователей. Они не используют JWT авторизацию, вместо этого используют секретный ключ бота.

## Авторизация

Для доступа к Bot API маршрутам необходимо передавать секретный ключ бота одним из способов:

1. В заголовке `x-bot-secret`
2. В query параметре `secret`

Секретный ключ настраивается через переменную окружения `BOT_REGISTRATION_SECRET`.

## Маршруты

### 1. Получить полные данные пользователя

**Endpoint:** `GET /bot/user/:telegramId`

Возвращает полную информацию о пользователе: данные профиля, статус подписки и активный VPN аккаунт.

**Параметры:**
- `telegramId` (path) - ID пользователя в Telegram

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/user/123456789" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

Или с query параметром:

```bash
curl -X GET "http://localhost:8080/bot/user/123456789?secret=YOUR_BOT_SECRET"
```

**Пример ответа:**

```json
{
  "user": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j0",
    "telegramId": "123456789",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "isPremium": false,
    "isBlocked": false
  },
  "subscription": {
    "status": "trial",
    "type": "trial",
    "timeLeft": {
      "type": "hours",
      "value": 2,
      "expiresAt": "2025-10-18T12:00:00.000Z"
    },
    "trialTraffic": {
      "limitMB": 100,
      "usedMB": 23.45,
      "remainingMB": 76.55,
      "usedPercent": 23
    }
  },
  "vpnAccount": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j1",
    "email": "user_123456789@example.com",
    "uuid": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "link": "vless://...",
    "isActive": true,
    "expiresAt": "2025-10-18T12:00:00.000Z",
    "createdAt": "2025-10-17T09:00:00.000Z"
  }
}
```

Для оплаченной подписки:

```json
{
  "user": { ... },
  "subscription": {
    "status": "active",
    "type": "monthly",
    "timeLeft": {
      "type": "days",
      "value": 25,
      "expiresAt": "2025-11-15T12:00:00.000Z"
    },
    "trialTraffic": null
  },
  "vpnAccount": { ... }
}
```

### 2. Получить только статус подписки

**Endpoint:** `GET /bot/user/:telegramId/subscription`

Возвращает только информацию о подписке пользователя.

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/user/123456789/subscription" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

**Пример ответа (Trial):**

```json
{
  "status": "trial",
  "type": "trial",
  "timeLeft": {
    "type": "hours",
    "value": 2,
    "expiresAt": "2025-10-18T12:00:00.000Z"
  },
  "trialTraffic": {
    "limitMB": 100,
    "usedMB": 23.45,
    "remainingMB": 76.55,
    "usedPercent": 23
  },
  "isPaid": false,
  "isTrial": true,
  "isExpired": false
}
```

**Пример ответа (Active/Paid):**

```json
{
  "status": "active",
  "type": "monthly",
  "timeLeft": {
    "type": "days",
    "value": 25,
    "expiresAt": "2025-11-15T12:00:00.000Z"
  },
  "trialTraffic": null,
  "isPaid": true,
  "isTrial": false,
  "isExpired": false
}
```

### 3. Получить только данные VPN аккаунта

**Endpoint:** `GET /bot/user/:telegramId/vpn`

Возвращает только информацию об активном VPN аккаунте пользователя.

**Важно:** У одного пользователя может быть только один активный оплаченный VPN аккаунт.

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/user/123456789/vpn" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

**Пример ответа (есть аккаунт):**

```json
{
  "hasAccount": true,
  "vpnAccount": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j1",
    "email": "user_123456789@example.com",
    "uuid": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "link": "vless://...",
    "isActive": true,
    "expiresAt": "2025-10-18T12:00:00.000Z",
    "createdAt": "2025-10-17T09:00:00.000Z"
  }
}
```

**Пример ответа (нет аккаунта):**

```json
{
  "error": "No active VPN account found",
  "hasAccount": false
}
```

## Статусы подписки

- `trial` - Пробный период (ограниченный трафик и время)
- `active` - Активная оплаченная подписка
- `expired` - Подписка истекла
- `cancelled` - Подписка отменена

## Типы подписок

- `trial` - Пробный период
- `monthly` - Месячная подписка (30 дней)
- `quarterly` - Квартальная подписка (90 дней)
- `yearly` - Годовая подписка (365 дней)

## Автоматическое удаление сессий

Документы из коллекции `sessions` автоматически удаляются MongoDB после истечения срока действия (поле `expiresAt`). Это настроено через TTL индекс в модели Session:

```typescript
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

MongoDB автоматически запускает фоновый процесс каждые 60 секунд для удаления истекших документов.

## Ошибки

### 401 Unauthorized
```json
{
  "error": "Invalid bot secret"
}
```

Неверный секретный ключ бота.

### 404 Not Found
```json
{
  "error": "User not found"
}
```

Пользователь с указанным telegramId не найден.

### 500 Internal Server Error
```json
{
  "error": "Internal error"
}
```

Внутренняя ошибка сервера.

## Использование в Telegram боте

Пример использования в Python (aiogram):

```python
import aiohttp
import os

BOT_SECRET = os.getenv("BOT_REGISTRATION_SECRET")
API_URL = "http://localhost:8080"

async def get_user_data(telegram_id: int):
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET}
        url = f"{API_URL}/bot/user/{telegram_id}"
        
        async with session.get(url, headers=headers) as response:
            if response.status == 200:
                return await response.json()
            else:
                error = await response.json()
                raise Exception(f"API Error: {error.get('error')}")

async def get_subscription_status(telegram_id: int):
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET}
        url = f"{API_URL}/bot/user/{telegram_id}/subscription"
        
        async with session.get(url, headers=headers) as response:
            if response.status == 200:
                data = await response.json()
                return data
            return None

# Использование в хендлере
@router.message(Command("status"))
async def cmd_status(message: Message):
    data = await get_user_data(message.from_user.id)
    
    if data['subscription']['status'] == 'trial':
        traffic = data['subscription']['trialTraffic']
        await message.answer(
            f"🔹 Пробный период\n"
            f"⏰ Осталось: {data['subscription']['timeLeft']['value']} часов\n"
            f"📊 Трафик: {traffic['usedMB']}/{traffic['limitMB']} MB ({traffic['usedPercent']}%)"
        )
    elif data['subscription']['status'] == 'active':
        await message.answer(
            f"✅ Активная подписка\n"
            f"📅 Осталось: {data['subscription']['timeLeft']['value']} дней\n"
            f"🔗 VPN активен"
        )
```

Пример для Node.js (grammy):

```typescript
import { Bot } from "grammy";
import axios from "axios";

const BOT_SECRET = process.env.BOT_REGISTRATION_SECRET;
const API_URL = "http://localhost:8080";

async function getUserData(telegramId: number) {
  const response = await axios.get(
    `${API_URL}/bot/user/${telegramId}`,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data;
}

bot.command("status", async (ctx) => {
  const data = await getUserData(ctx.from.id);
  
  if (data.subscription.status === "trial") {
    const traffic = data.subscription.trialTraffic;
    await ctx.reply(
      `🔹 Пробный период\n` +
      `⏰ Осталось: ${data.subscription.timeLeft.value} часов\n` +
      `📊 Трафик: ${traffic.usedMB}/${traffic.limitMB} MB (${traffic.usedPercent}%)`
    );
  } else if (data.subscription.status === "active") {
    await ctx.reply(
      `✅ Активная подписка\n` +
      `📅 Осталось: ${data.subscription.timeLeft.value} дней\n` +
      `🔗 VPN активен`
    );
  }
});
```

## Безопасность

⚠️ **Важно:** Никогда не передавайте `BOT_REGISTRATION_SECRET` клиенту или публично. Этот ключ должен использоваться только на стороне бота-сервера.

Рекомендуемая настройка безопасности:
1. Используйте сильный секретный ключ (минимум 32 символа)
2. Храните ключ в переменных окружения, не в коде
3. Используйте HTTPS в продакшене
4. Логируйте все запросы к Bot API для аудита

