# Bot API Routes

Эти маршруты предназначены для использования телеграм ботом для получения данных пользователей. Они не используют JWT авторизацию, вместо этого используют секретный ключ бота.

## Авторизация

Для доступа к Bot API маршрутам необходимо передавать секретный ключ бота одним из способов:

1. В заголовке `x-bot-secret`
2. В query параметре `secret`

Секретный ключ настраивается через переменную окружения `BOT_REGISTRATION_SECRET`.

## Маршруты

### 1. Проверить существование пользователя

**Endpoint:** `GET /bot/check-user/:telegramId`

Проверяет, зарегистрирован ли пользователь в системе.

**Параметры:**
- `telegramId` (path) - ID пользователя в Telegram

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/check-user/123456789" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

**Пример ответа (пользователь существует):**

```json
{
  "exists": true,
  "telegramId": "123456789",
  "userId": "64f9a1b2c3d4e5f6g7h8i9j0"
}
```

**Пример ответа (пользователь не существует):**

```json
{
  "exists": false,
  "telegramId": "123456789",
  "userId": null
}
```

### 2. Получить полные данные пользователя

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

### 3. Получить только статус подписки

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

### 4. Получить только данные VPN аккаунта

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

### 5. Получить статистику рефералов пользователя

**Endpoint:** `GET /bot/user/:telegramId/referrals`

Возвращает подробную статистику рефералов пользователя.

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/user/123456789/referrals" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

**Пример ответа:**

```json
{
  "user": {
    "telegramId": "123456789",
    "referralCode": "ref_123456789",
    "referralCount": 5,
    "referralBonusTrafficMB": 250,
    "referralBonusDays": 0
  },
  "stats": {
    "totalReferrals": 5,
    "activeReferrals": 4,
    "totalBonusTrafficMB": 250,
    "totalBonusDays": 0
  },
  "referrals": [
    {
      "id": "64f9a1b2c3d4e5f6g7h8i9j2",
      "referredUser": {
        "telegramId": "987654321",
        "username": "newuser",
        "firstName": "New",
        "lastName": "User",
        "isPremium": false,
        "subscriptionStatus": "trial"
      },
      "bonusGranted": true,
      "bonusType": "traffic",
      "bonusTrafficMB": 50,
      "bonusDays": 0,
      "bonusGrantedAt": "2025-10-15T10:00:00.000Z",
      "isActive": true,
      "createdAt": "2025-10-15T10:00:00.000Z"
    }
  ]
}
```

### 6. Получить реферальный код пользователя

**Endpoint:** `GET /bot/user/:telegramId/referral-code`

Возвращает реферальный код и ссылку пользователя для приглашения друзей.

**Пример запроса:**

```bash
curl -X GET "http://localhost:8080/bot/user/123456789/referral-code" \
  -H "x-bot-secret: YOUR_BOT_SECRET"
```

**Пример ответа:**

```json
{
  "telegramId": "123456789",
  "referralCode": "ref_123456789",
  "referralLink": "https://t.me/vpnbot?start=ref_123456789",
  "referralCount": 5
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

async def check_user_exists(telegram_id: int):
    """Проверить, зарегистрирован ли пользователь"""
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET}
        url = f"{API_URL}/bot/check-user/{telegram_id}"
        
        async with session.get(url, headers=headers) as response:
            if response.status == 200:
                data = await response.json()
                return data['exists']
            else:
                error = await response.json()
                raise Exception(f"API Error: {error.get('error')}")

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

# Использование в хендлерах
@router.message(Command("start"))
async def cmd_start(message: Message):
    """Проверяем пользователя при старте и регистрируем если нужно"""
    telegram_id = message.from_user.id
    
    # Проверяем существование пользователя
    user_exists = await check_user_exists(telegram_id)
    
    if not user_exists:
        # Регистрируем нового пользователя
        await message.answer("👋 Добро пожаловать! Регистрируем вас в системе...")
        # Здесь вызываем /auth/bot-register
        # ...
    else:
        # Пользователь уже есть
        await message.answer("👋 С возвращением!")

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

async function checkUserExists(telegramId: number): Promise<boolean> {
  const response = await axios.get(
    `${API_URL}/bot/check-user/${telegramId}`,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data.exists;
}

async function getUserData(telegramId: number) {
  const response = await axios.get(
    `${API_URL}/bot/user/${telegramId}`,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data;
}

bot.command("start", async (ctx) => {
  // Проверяем пользователя при старте
  const userExists = await checkUserExists(ctx.from.id);
  
  if (!userExists) {
    await ctx.reply("👋 Добро пожаловать! Регистрируем вас в системе...");
    // Здесь вызываем регистрацию через POST /auth/bot-register
    // ...
  } else {
    await ctx.reply("👋 С возвращением!");
  }
});

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

## Реферальная система

### Описание

Реферальная система позволяет пользователям приглашать друзей и получать бонусы за каждого приглашенного пользователя.

### Механизм работы

1. **Генерация реферального кода:**
   - При регистрации каждому пользователю автоматически генерируется уникальный реферальный код в формате `ref_<telegramId>`
   - Пример: `ref_123456789`

2. **Реферальная ссылка:**
   - Формат: `https://t.me/<BOT_USERNAME>?start=ref_<telegramId>`
   - Пример: `https://t.me/vpnbot?start=ref_123456789`

3. **Обработка реферального кода:**
   - При регистрации нового пользователя через `/auth/bot-register` передается параметр `referralCode`
   - Если код валиден, создается связь между реферером и приглашенным
   - Рефереру автоматически начисляются бонусы

4. **Типы бонусов:**
   - `traffic` - дополнительный трафик (по умолчанию: 50 MB за каждого реферала)
   - `days` - дополнительные дни подписки
   - `both` - и трафик, и дни

### Пример регистрации с реферальным кодом

**POST** `/auth/bot-register`

```json
{
  "telegramId": "987654321",
  "username": "newuser",
  "firstName": "New",
  "lastName": "User",
  "languageCode": "ru",
  "isPremium": false,
  "referralCode": "ref_123456789"
}
```

**Ответ:**

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {
    "id": "...",
    "telegramId": "987654321",
    "referralCode": "ref_987654321",
    "referredBy": "123456789",
    "referralCount": 0
  },
  "vlessAccount": { ... },
  "referral": {
    "success": true,
    "error": null
  }
}
```

### Настройка бонусов

Бонусы настраиваются через переменные окружения:

```env
# Бонус трафика за каждого реферала (в MB)
REFERRAL_BONUS_TRAFFIC_MB=50

# Бонусные дни подписки за каждого реферала
REFERRAL_BONUS_DAYS=0

# Тип бонуса: traffic | days | both
REFERRAL_BONUS_TYPE=traffic

# Username бота для генерации реферальных ссылок
BOT_USERNAME=vpnbot
```

### Ограничения

- Пользователь не может использовать свой собственный реферальный код
- Реферальный код можно использовать только один раз (при первой регистрации)
- Если пользователь уже зарегистрирован, повторное использование реферального кода игнорируется
- Бонусы начисляются только за активных пользователей

## Безопасность

⚠️ **Важно:** Никогда не передавайте `BOT_REGISTRATION_SECRET` клиенту или публично. Этот ключ должен использоваться только на стороне бота-сервера.

Рекомендуемая настройка безопасности:
1. Используйте сильный секретный ключ (минимум 32 символа)
2. Храните ключ в переменных окружения, не в коде
3. Используйте HTTPS в продакшене
4. Логируйте все запросы к Bot API для аудита

