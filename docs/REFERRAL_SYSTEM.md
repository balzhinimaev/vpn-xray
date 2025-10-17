# Реферальная система

## Описание

Реферальная система позволяет пользователям приглашать друзей и получать бонусы (дополнительный трафик или дни подписки) за каждого приглашенного пользователя.

## Настройка

### Переменные окружения

Добавьте в `.env` файл следующие переменные:

```env
# Username бота для генерации реферальных ссылок
BOT_USERNAME=vpnbot

# Бонус трафика за каждого приглашенного пользователя (в MB)
REFERRAL_BONUS_TRAFFIC_MB=50

# Бонусные дни подписки за каждого приглашенного пользователя
REFERRAL_BONUS_DAYS=0

# Тип бонуса: traffic | days | both
REFERRAL_BONUS_TYPE=traffic
```

### Модели базы данных

Реферальная система добавляет следующие поля в модель `User`:

- `referralCode` - уникальный реферальный код пользователя (`ref_<telegramId>`)
- `referredBy` - telegramId реферера (если пользователь был приглашен)
- `referralCount` - количество приглашенных пользователей
- `referralBonusTrafficBytes` - бонусный трафик от рефералов (в байтах)
- `referralBonusDays` - бонусные дни подписки от рефералов

Также добавлена модель `Referral` для детальной статистики.

## Как это работает

### 1. Генерация реферальной ссылки

При регистрации пользователю автоматически генерируется реферальный код в формате `ref_<telegramId>`.

**Пример:**
- telegramId: `123456789`
- referralCode: `ref_123456789`
- referralLink: `https://t.me/vpnbot?start=ref_123456789`

### 2. Получение реферальной ссылки в боте

**Запрос:**
```bash
GET /bot/user/123456789/referral-code
Headers: x-bot-secret: YOUR_BOT_SECRET
```

**Ответ:**
```json
{
  "telegramId": "123456789",
  "referralCode": "ref_123456789",
  "referralLink": "https://t.me/vpnbot?start=ref_123456789",
  "referralCount": 5
}
```

### 3. Обработка реферального кода при регистрации

Когда новый пользователь переходит по реферальной ссылке и запускает бота, в команде `/start` будет параметр:

```
/start ref_123456789
```

При регистрации нового пользователя через `/auth/bot-register` передайте реферальный код:

**Запрос:**
```bash
POST /auth/bot-register
Headers: x-bot-secret: YOUR_BOT_SECRET
Content-Type: application/json

{
  "telegramId": "987654321",
  "username": "newuser",
  "firstName": "New",
  "lastName": "User",
  "referralCode": "ref_123456789"
}
```

**Ответ:**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": {
    "telegramId": "987654321",
    "referralCode": "ref_987654321",
    "referredBy": "123456789",
    "referralCount": 0
  },
  "vlessAccount": { ... },
  "referral": {
    "success": true
  }
}
```

### 4. Получение статистики рефералов

**Запрос:**
```bash
GET /bot/user/123456789/referrals
Headers: x-bot-secret: YOUR_BOT_SECRET
```

**Ответ:**
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
      "referredUser": {
        "telegramId": "987654321",
        "username": "newuser",
        "firstName": "New",
        "subscriptionStatus": "trial"
      },
      "bonusGranted": true,
      "bonusType": "traffic",
      "bonusTrafficMB": 50,
      "bonusDays": 0,
      "createdAt": "2025-10-15T10:00:00.000Z"
    }
  ]
}
```

## Примеры использования в боте

### Python (aiogram 3.x)

```python
from aiogram import Router, F
from aiogram.filters import CommandStart, CommandObject
from aiogram.types import Message
import aiohttp
import os

router = Router()

BOT_SECRET = os.getenv("BOT_REGISTRATION_SECRET")
API_URL = os.getenv("API_URL", "http://localhost:8080")

async def register_user(telegram_id: int, user_data: dict, referral_code: str = None):
    """Регистрация пользователя в системе"""
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET, "Content-Type": "application/json"}
        
        payload = {
            "telegramId": str(telegram_id),
            "username": user_data.get("username"),
            "firstName": user_data.get("first_name"),
            "lastName": user_data.get("last_name"),
            "languageCode": user_data.get("language_code", "en"),
            "isPremium": user_data.get("is_premium", False),
        }
        
        # Добавляем реферальный код, если есть
        if referral_code:
            payload["referralCode"] = referral_code
        
        async with session.post(f"{API_URL}/auth/bot-register", headers=headers, json=payload) as response:
            if response.status == 200:
                data = await response.json()
                return data
            else:
                error = await response.json()
                raise Exception(f"Registration failed: {error.get('error')}")

async def get_referral_code(telegram_id: int):
    """Получить реферальный код пользователя"""
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET}
        
        async with session.get(f"{API_URL}/bot/user/{telegram_id}/referral-code", headers=headers) as response:
            if response.status == 200:
                return await response.json()
            return None

async def get_referral_stats(telegram_id: int):
    """Получить статистику рефералов"""
    async with aiohttp.ClientSession() as session:
        headers = {"x-bot-secret": BOT_SECRET}
        
        async with session.get(f"{API_URL}/bot/user/{telegram_id}/referrals", headers=headers) as response:
            if response.status == 200:
                return await response.json()
            return None

@router.message(CommandStart(deep_link=True))
async def cmd_start_with_referral(message: Message, command: CommandObject):
    """Обработка команды /start с реферальным кодом"""
    referral_code = command.args  # Например: ref_123456789
    
    try:
        # Регистрируем пользователя с реферальным кодом
        user_data = {
            "username": message.from_user.username,
            "first_name": message.from_user.first_name,
            "last_name": message.from_user.last_name,
            "language_code": message.from_user.language_code,
            "is_premium": message.from_user.is_premium,
        }
        
        result = await register_user(message.from_user.id, user_data, referral_code)
        
        if result.get("referral", {}).get("success"):
            await message.answer(
                "🎉 Добро пожаловать! Вы успешно зарегистрированы по реферальной ссылке!\n"
                "Ваш реферер получил бонус за ваше приглашение."
            )
        else:
            await message.answer("👋 Добро пожаловать!")
            
    except Exception as e:
        print(f"Error during registration: {e}")
        await message.answer("Произошла ошибка при регистрации. Попробуйте позже.")

@router.message(CommandStart())
async def cmd_start(message: Message):
    """Обработка команды /start без реферального кода"""
    try:
        user_data = {
            "username": message.from_user.username,
            "first_name": message.from_user.first_name,
            "last_name": message.from_user.last_name,
            "language_code": message.from_user.language_code,
            "is_premium": message.from_user.is_premium,
        }
        
        await register_user(message.from_user.id, user_data)
        await message.answer("👋 Добро пожаловать!")
        
    except Exception as e:
        print(f"Error during registration: {e}")

@router.message(F.text == "🎁 Пригласить друга")
async def cmd_referral(message: Message):
    """Показать реферальную ссылку"""
    try:
        data = await get_referral_code(message.from_user.id)
        
        if data:
            await message.answer(
                f"🎁 Ваша реферальная ссылка:\n\n"
                f"{data['referralLink']}\n\n"
                f"👥 Приглашено друзей: {data['referralCount']}\n\n"
                f"💡 За каждого приглашенного друга вы получаете бонус!"
            )
    except Exception as e:
        print(f"Error getting referral code: {e}")

@router.message(F.text == "📊 Мои рефералы")
async def cmd_referral_stats(message: Message):
    """Показать статистику рефералов"""
    try:
        data = await get_referral_stats(message.from_user.id)
        
        if data:
            stats = data['stats']
            user = data['user']
            
            text = (
                f"📊 Ваша реферальная статистика:\n\n"
                f"👥 Всего рефералов: {stats['totalReferrals']}\n"
                f"✅ Активных: {stats['activeReferrals']}\n"
                f"🎁 Получено бонусов:\n"
                f"  • Трафик: {user['referralBonusTrafficMB']} MB\n"
                f"  • Дни: {user['referralBonusDays']}\n\n"
            )
            
            if data['referrals']:
                text += "Последние рефералы:\n"
                for ref in data['referrals'][:5]:
                    user_info = ref['referredUser']
                    name = user_info['firstName'] or user_info['username'] or 'Пользователь'
                    status_emoji = "✅" if user_info['subscriptionStatus'] == 'active' else "🔹"
                    text += f"{status_emoji} {name}\n"
            
            await message.answer(text)
    except Exception as e:
        print(f"Error getting referral stats: {e}")
```

### Node.js (Grammy)

```typescript
import { Bot, Context } from "grammy";
import axios from "axios";

const BOT_SECRET = process.env.BOT_REGISTRATION_SECRET!;
const API_URL = process.env.API_URL || "http://localhost:8080";

interface UserData {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  referralCode?: string;
}

async function registerUser(data: UserData) {
  const response = await axios.post(
    `${API_URL}/auth/bot-register`,
    data,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data;
}

async function getReferralCode(telegramId: number) {
  const response = await axios.get(
    `${API_URL}/bot/user/${telegramId}/referral-code`,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data;
}

async function getReferralStats(telegramId: number) {
  const response = await axios.get(
    `${API_URL}/bot/user/${telegramId}/referrals`,
    {
      headers: { "x-bot-secret": BOT_SECRET },
    }
  );
  return response.data;
}

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", async (ctx) => {
  const referralCode = ctx.match; // Реферальный код из deep link
  
  try {
    const result = await registerUser({
      telegramId: ctx.from.id.toString(),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      languageCode: ctx.from.language_code,
      isPremium: ctx.from.is_premium,
      referralCode: referralCode || undefined,
    });
    
    if (result.referral?.success) {
      await ctx.reply(
        "🎉 Добро пожаловать! Вы успешно зарегистрированы по реферальной ссылке!"
      );
    } else {
      await ctx.reply("👋 Добро пожаловать!");
    }
  } catch (error) {
    console.error("Registration error:", error);
  }
});

bot.hears("🎁 Пригласить друга", async (ctx) => {
  try {
    const data = await getReferralCode(ctx.from.id);
    
    await ctx.reply(
      `🎁 Ваша реферальная ссылка:\n\n` +
      `${data.referralLink}\n\n` +
      `👥 Приглашено друзей: ${data.referralCount}\n\n` +
      `💡 За каждого приглашенного друга вы получаете бонус!`
    );
  } catch (error) {
    console.error("Error getting referral code:", error);
  }
});

bot.hears("📊 Мои рефералы", async (ctx) => {
  try {
    const data = await getReferralStats(ctx.from.id);
    
    let text = 
      `📊 Ваша реферальная статистика:\n\n` +
      `👥 Всего рефералов: ${data.stats.totalReferrals}\n` +
      `✅ Активных: ${data.stats.activeReferrals}\n` +
      `🎁 Получено бонусов:\n` +
      `  • Трафик: ${data.user.referralBonusTrafficMB} MB\n` +
      `  • Дни: ${data.user.referralBonusDays}\n`;
    
    await ctx.reply(text);
  } catch (error) {
    console.error("Error getting referral stats:", error);
  }
});

bot.start();
```

## Частые вопросы

**Q: Можно ли использовать свой реферальный код?**  
A: Нет, система автоматически проверяет и отклоняет попытки использования собственного реферального кода.

**Q: Можно ли использовать реферальный код несколько раз?**  
A: Нет, реферальный код можно использовать только при первой регистрации.

**Q: Как начисляются бонусы?**  
A: Бонусы начисляются автоматически при успешной регистрации нового пользователя по реферальной ссылке.

**Q: Можно ли изменить размер бонусов?**  
A: Да, через переменные окружения `REFERRAL_BONUS_TRAFFIC_MB`, `REFERRAL_BONUS_DAYS` и `REFERRAL_BONUS_TYPE`.

**Q: Что произойдет, если реферал заблокирован?**  
A: В модели `Referral` есть поле `isActive`, которое можно использовать для отзыва бонусов (требует дополнительной реализации).

