# Payment Webhook API

Webhook для обработки успешных платежей от Telegram Stars.

## Endpoints

### POST /webhook/telegram-payment

Обрабатывает уведомления об успешных платежах от Telegram Stars.

**Заголовки:**
- `Content-Type: application/json`
- `x-telegram-bot-api-secret-token: YOUR_SECRET_TOKEN` (опционально, для валидации)

**Тело запроса:**
```json
{
  "currency": "XTR",
  "total_amount": 1,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"period\":\"week\",\"user_id\":1272270574,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "stxB0Kv34MV1OVpOErBGHyTte9PLz7XyjFUlb5isGpmFjZTs_aqGrTXTi7WO6Xqw9vHZdbYKy_In-_vlCTY0aTSadvS186B29V5um5Io-5uX7QRICdTQY9TykEtHDBUgX0D",
  "provider_payment_charge_id": "1272270574_35"
}
```

**Параметры payload:**
- `type` - тип платежа (должен быть "vpn_subscription")
- `period` - период подписки ("week", "month", "quarter", "year") - опционально
- `days` - количество дней подписки (число) - опционально
- `user_id` - Telegram ID пользователя
- `timestamp` - временная метка

**Примечание:** Укажите либо `period`, либо `days`. Если указаны оба, приоритет у `days`.

**Ответ при успехе:**
```json
{
  "ok": true,
  "message": "Payment processed successfully",
  "subscription": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j0",
    "type": "weekly",
    "startsAt": "2025-01-17T10:00:00.000Z",
    "endsAt": "2025-01-24T10:00:00.000Z"
  },
  "user": {
    "telegramId": "1272270574",
    "subscriptionStatus": "active",
    "subscriptionEndsAt": "2025-01-24T10:00:00.000Z"
  },
  "vlessAccount": {
    "id": "64f9a1b2c3d4e5f6g7h8i9j1",
    "email": "user_1272270574@example.com",
    "link": "vless://...",
    "isActive": true,
    "expiresAt": "2025-01-24T10:00:00.000Z"
  }
}
```

**Ответ при ошибке:**
```json
{
  "error": "User not found",
  "message": "Пользователь не найден"
}
```

### GET /webhook/telegram-payment/status

Проверка статуса webhook'а.

**Ответ:**
```json
{
  "ok": true,
  "message": "Payment webhook is active",
  "timestamp": "2025-01-17T10:00:00.000Z"
}
```

## Поддерживаемые периоды подписки

### Предопределенные периоды (через `period`)

| period | Тип подписки | Длительность |
|--------|--------------|--------------|
| week   | weekly       | 7 дней       |
| month  | monthly      | 30 дней      |
| quarter| quarterly    | 90 дней      |
| year   | yearly       | 365 дней     |

### Кастомные периоды (через `days`)

Можно указать любое количество дней от 1 до 365. Тип подписки определяется автоматически:

- **1-7 дней** → `weekly`
- **8-31 день** → `monthly` 
- **32-93 дня** → `quarterly`
- **94+ дней** → `yearly`

**Примеры:**
```json
{"type": "vpn_subscription", "days": 14, "user_id": 123456789, "timestamp": 1760847554121}
{"type": "vpn_subscription", "days": 45, "user_id": 123456789, "timestamp": 1760847554121}
{"type": "vpn_subscription", "days": 180, "user_id": 123456789, "timestamp": 1760847554121}
```

## Автоматические действия

При успешной обработке платежа система автоматически:

1. **Создает/обновляет подписку** в базе данных
2. **Активирует VLESS аккаунт** пользователя
3. **Отправляет уведомление** пользователю в Telegram с:
   - Подтверждением оплаты
   - Информацией о подписке
   - VLESS ссылкой для подключения

## Безопасность

- Webhook проверяет уникальность `telegram_payment_charge_id` для предотвращения дублирования
- Поддерживается валидация подписи от Telegram (настраивается)
- Rate limiting применяется ко всем запросам

## Настройка в Telegram

1. Установите webhook URL в настройках бота:
   ```
   https://your-domain.com/webhook/telegram-payment
   ```

2. Убедитесь, что `BOT_TOKEN` настроен в переменных окружения

3. Опционально настройте `x-telegram-bot-api-secret-token` для дополнительной безопасности

## Логирование

Все операции логируются с префиксами:
- `💰` - Успешные платежи
- `✅` - Успешные операции
- `❌` - Ошибки
- `⚠️` - Предупреждения

## Примеры использования

### cURL
```bash
curl -X POST "https://your-domain.com/webhook/telegram-payment" \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: YOUR_SECRET" \
  -d '{
    "currency": "XTR",
    "total_amount": 1,
    "invoice_payload": "{\"type\":\"vpn_subscription\",\"period\":\"week\",\"user_id\":1272270574,\"timestamp\":1760847554121}",
    "telegram_payment_charge_id": "stxB0Kv34MV1OVpOErBGHyTte9PLz7XyjFUlb5isGpmFjZTs_aqGrTXTi7WO6Xqw9vHZdbYKy_In-_vlCTY0aTSadvS186B29V5um5Io-5uX7QRICdTQY9TykEtHDBUgX0D",
    "provider_payment_charge_id": "1272270574_35"
  }'
```

### JavaScript/Node.js

**С предопределенным периодом:**
```javascript
const response = await fetch('https://your-domain.com/webhook/telegram-payment', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-telegram-bot-api-secret-token': 'YOUR_SECRET'
  },
  body: JSON.stringify({
    currency: 'XTR',
    total_amount: 1,
    invoice_payload: JSON.stringify({
      type: 'vpn_subscription',
      period: 'week',
      user_id: 1272270574,
      timestamp: Date.now()
    }),
    telegram_payment_charge_id: 'unique_payment_id',
    provider_payment_charge_id: 'provider_id'
  })
});
```

**С кастомным периодом (14 дней):**
```javascript
const response = await fetch('https://your-domain.com/webhook/telegram-payment', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-telegram-bot-api-secret-token': 'YOUR_SECRET'
  },
  body: JSON.stringify({
    currency: 'XTR',
    total_amount: 2,
    invoice_payload: JSON.stringify({
      type: 'vpn_subscription',
      days: 14,
      user_id: 1272270574,
      timestamp: Date.now()
    }),
    telegram_payment_charge_id: 'unique_payment_id_14days',
    provider_payment_charge_id: 'provider_id_14days'
  })
});

const result = await response.json();
console.log(result);
```
