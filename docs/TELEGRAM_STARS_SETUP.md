# Настройка Telegram Stars для VPN сервиса

## Обзор

Проект теперь поддерживает обработку платежей через Telegram Stars с автоматической активацией подписок и отправкой уведомлений пользователям.

## Что было добавлено

### 1. Webhook для обработки платежей
- **Endpoint**: `POST /webhook/telegram-payment`
- **Функции**:
  - Обработка уведомлений об успешных платежах
  - Автоматическая активация подписок
  - Создание/обновление VLESS аккаунтов
  - Отправка уведомлений пользователям

### 2. Поддержка новых типов подписок
- **weekly** - недельная подписка (7 дней)
- **monthly** - месячная подписка (30 дней)
- **quarterly** - квартальная подписка (90 дней)
- **yearly** - годовая подписка (365 дней)

### 3. Система уведомлений
- Автоматические уведомления об успешной оплате
- Напоминания об истечении подписки
- Предупреждения о трафике для триальных пользователей

## Настройка

### 1. Переменные окружения

Убедитесь, что настроены следующие переменные:

```env
# Telegram Bot
BOT_TOKEN=your_bot_token_from_botfather
BOT_USERNAME=your_bot_username
BOT_REGISTRATION_SECRET=your_secure_secret

# Xray Configuration
X_PUBLIC_HOST=your-server-domain.com
X_DEFAULT_FLOW=xtls-rprx-vision
```

### 2. Настройка webhook в Telegram

1. Получите токен бота от @BotFather
2. Установите webhook URL:
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-domain.com/webhook/telegram-payment"}'
   ```

3. Проверьте статус webhook:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
   ```

### 3. Структура данных платежа

Telegram Stars отправляет данные в следующем формате:

```json
{
  "currency": "XTR",
  "total_amount": 1,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"period\":\"week\",\"user_id\":1272270574,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "unique_payment_id",
  "provider_payment_charge_id": "provider_id"
}
```

**Параметры payload:**
- `type` - должен быть "vpn_subscription"
- `period` - период подписки ("week", "month", "quarter", "year") - опционально
- `days` - количество дней подписки (число) - опционально
- `user_id` - Telegram ID пользователя
- `timestamp` - временная метка

**Примечание:** Укажите либо `period`, либо `days`. Если указаны оба, приоритет у `days`.

## Тестирование

### 1. Проверка статуса webhook'а

```bash
curl "https://your-domain.com/webhook/telegram-payment/status"
```

### 2. Тестовый платеж

**С предопределенным периодом:**
```bash
curl -X POST "https://your-domain.com/webhook/telegram-payment" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "XTR",
    "total_amount": 1,
    "invoice_payload": "{\"type\":\"vpn_subscription\",\"period\":\"week\",\"user_id\":1272270574,\"timestamp\":1760847554121}",
    "telegram_payment_charge_id": "test_payment_123",
    "provider_payment_charge_id": "provider_123"
  }'
```

**С кастомным периодом (14 дней):**
```bash
curl -X POST "https://your-domain.com/webhook/telegram-payment" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "XTR",
    "total_amount": 2,
    "invoice_payload": "{\"type\":\"vpn_subscription\",\"days\":14,\"user_id\":1272270574,\"timestamp\":1760847554121}",
    "telegram_payment_charge_id": "test_payment_14days",
    "provider_payment_charge_id": "provider_14days"
  }'
```

## Автоматические действия

При успешной обработке платежа система:

1. **Проверяет** существование пользователя
2. **Создает/обновляет** подписку в базе данных
3. **Активирует/создает** VLESS аккаунт
4. **Отправляет уведомление** пользователю в Telegram с:
   - Подтверждением оплаты
   - Информацией о подписке
   - VLESS ссылкой для подключения

## Безопасность

- Проверка уникальности `telegram_payment_charge_id`
- Поддержка валидации подписи от Telegram
- Rate limiting на все запросы
- Логирование всех операций

## Мониторинг

Все операции логируются с префиксами:
- `💰` - Успешные платежи
- `✅` - Успешные операции
- `❌` - Ошибки
- `⚠️` - Предупреждения

## Поддержка

При возникновении проблем проверьте:

1. Логи сервера на наличие ошибок
2. Настройки webhook'а в Telegram
3. Переменные окружения
4. Доступность базы данных и Xray сервера

## Документация API

Полная документация доступна в:
- `docs/PAYMENT_WEBHOOK.md` - API webhook'а
- `docs/BOT_API.md` - Bot API
- `docs/postman/` - Примеры запросов
