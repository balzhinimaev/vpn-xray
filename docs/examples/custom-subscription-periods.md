# Примеры кастомных периодов подписки

## Обзор

Теперь webhook поддерживает гибкие периоды подписки через параметр `days` в payload.

## Примеры использования

### 1. Короткие периоды (1-7 дней)

```json
{
  "currency": "XTR",
  "total_amount": 1,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"days\":3,\"user_id\":123456789,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "payment_3days",
  "provider_payment_charge_id": "provider_3days"
}
```
**Результат:** 3-дневная подписка типа `weekly`

### 2. Средние периоды (8-31 день)

```json
{
  "currency": "XTR",
  "total_amount": 2,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"days\":14,\"user_id\":123456789,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "payment_14days",
  "provider_payment_charge_id": "provider_14days"
}
```
**Результат:** 14-дневная подписка типа `monthly`

### 3. Длинные периоды (32-93 дня)

```json
{
  "currency": "XTR",
  "total_amount": 5,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"days\":60,\"user_id\":123456789,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "payment_60days",
  "provider_payment_charge_id": "provider_60days"
}
```
**Результат:** 60-дневная подписка типа `quarterly`

### 4. Очень длинные периоды (94+ дней)

```json
{
  "currency": "XTR",
  "total_amount": 10,
  "invoice_payload": "{\"type\":\"vpn_subscription\",\"days\":180,\"user_id\":123456789,\"timestamp\":1760847554121}",
  "telegram_payment_charge_id": "payment_180days",
  "provider_payment_charge_id": "provider_180days"
}
```
**Результат:** 180-дневная подписка типа `yearly`

## Логика определения типа подписки

| Дни | Тип подписки | Описание |
|-----|--------------|----------|
| 1-7 | `weekly` | Короткие периоды |
| 8-31 | `monthly` | Средние периоды |
| 32-93 | `quarterly` | Длинные периоды |
| 94+ | `yearly` | Очень длинные периоды |

## Совместимость

- Если указаны и `period`, и `days`, приоритет у `days`
- Если указан только `period`, используется предопределенная логика
- Если указан только `days`, используется кастомная логика
- Если не указано ни то, ни другое, возвращается ошибка

## Тестирование

Используйте Postman коллекцию `docs/postman/payment-webhook-example.json` или cURL команды из документации для тестирования различных периодов.
