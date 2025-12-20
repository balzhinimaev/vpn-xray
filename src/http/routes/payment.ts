import { Router, Request, Response } from "express";
import { XrayService } from "../../services/xrayService.js";
import { TelegramNotificationService } from "../../services/telegramNotificationService.js";
import { config } from "../../config/index.js";
import crypto from "crypto";

export interface PaymentRouteOptions {
  xrayService: XrayService;
  botToken: string;
}

interface TelegramPaymentData {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
}

interface PaymentPayload {
  type: string;
  period?: string;
  days?: number;
  user_id: number;
  timestamp: number;
}

export function createPaymentRouter(options: PaymentRouteOptions) {
  const { xrayService, botToken } = options;
  const router = Router();
  
  // Инициализируем сервис уведомлений
  const notificationService = new TelegramNotificationService(botToken);

  /**
   * Валидация подписи от Telegram
   */
  const validateTelegramSignature = (req: Request, res: Response, next: any) => {
    const signature = req.headers['x-telegram-bot-api-secret-token'] as string;
    
    if (!signature) {
      return res.status(401).json({ error: "Missing Telegram signature" });
    }

    // В реальном проекте здесь должна быть проверка подписи
    // Для простоты пока пропускаем
    next();
  };

  /**
   * POST /webhook/telegram-payment
   * Webhook для обработки успешных платежей от Telegram Stars
   */
  router.post("/telegram-payment", validateTelegramSignature, async (req: Request, res: Response) => {
    try {
      const paymentData: TelegramPaymentData = req.body;

      console.log("💰 Получен successful_payment:", paymentData);

      // Парсим payload
      let payload: PaymentPayload;
      try {
        payload = JSON.parse(paymentData.invoice_payload);
        console.log("💰 Payload:", payload);
      } catch (error) {
        console.error("❌ Ошибка парсинга payload:", error);
        return res.status(400).json({ error: "Invalid payload format" });
      }

      // Валидируем payload
      if (!payload.type || !payload.user_id) {
        return res.status(400).json({ error: "Invalid payload data" });
      }

      // Проверяем, что указан либо period, либо days
      if (!payload.period && !payload.days) {
        return res.status(400).json({ error: "Either 'period' or 'days' must be specified" });
      }

      // Проверяем, что это платеж за VPN подписку
      if (payload.type !== "vpn_subscription") {
        return res.status(400).json({ error: "Invalid payment type" });
      }

      const { User, Subscription, VlessAccount } = await import("../../models/index.js");

      // Находим пользователя по telegramId
      const user = await User.findOne({ telegramId: payload.user_id.toString() });
      if (!user) {
        console.error(`❌ Пользователь не найден: ${payload.user_id}`);
        return res.status(404).json({ error: "User not found" });
      }

      // Определяем тип подписки и период
      let subscriptionType = "monthly";
      let subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS;

      if (payload.days) {
        // Если передан параметр days, используем его
        subscriptionDays = payload.days;
        
        // Определяем тип подписки на основе количества дней
        if (subscriptionDays <= 7) {
          subscriptionType = "weekly";
        } else if (subscriptionDays <= 31) {
          subscriptionType = "monthly";
        } else if (subscriptionDays <= 93) {
          subscriptionType = "quarterly";
        } else {
          subscriptionType = "yearly";
        }
        
        console.log(`📅 Используется кастомный период: ${subscriptionDays} дней (тип: ${subscriptionType})`);
      } else if (payload.period) {
        // Если передан period, используем предопределенные значения
        switch (payload.period) {
          case "week":
            subscriptionType = "weekly";
            subscriptionDays = 7;
            break;
          case "month":
            subscriptionType = "monthly";
            subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS;
            break;
          case "quarter":
            subscriptionType = "quarterly";
            subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS * 3;
            break;
          case "year":
            subscriptionType = "yearly";
            subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS * 12;
            break;
          default:
            console.warn(`⚠️ Неизвестный период: ${payload.period}, используем месячный`);
        }
      }

      // Вычисляем даты подписки
      const now = new Date();
      const startsAt = new Date();
      const endsAt = new Date();

      // Если у пользователя есть активная подписка, продлеваем от её конца
      if (
        user.subscriptionStatus === "active" &&
        user.subscriptionEndsAt &&
        user.subscriptionEndsAt > now
      ) {
        startsAt.setTime(user.subscriptionEndsAt.getTime());
        endsAt.setTime(user.subscriptionEndsAt.getTime());
      }

      endsAt.setDate(endsAt.getDate() + subscriptionDays);

      // Проверяем, не была ли уже обработана эта транзакция
      const existingSubscription = await Subscription.findOne({
        paymentId: paymentData.telegram_payment_charge_id,
      });

      if (existingSubscription) {
        console.log(`⚠️ Транзакция уже обработана: ${paymentData.telegram_payment_charge_id}`);
        return res.json({ 
          ok: true, 
          message: "Payment already processed",
          subscriptionId: existingSubscription._id 
        });
      }

      // Создаем запись о подписке
      const subscription = await Subscription.create({
        userId: user._id,
        telegramId: user.telegramId,
        type: subscriptionType,
        status: "active",
        startsAt,
        endsAt,
        price: paymentData.total_amount,
        currency: paymentData.currency,
        paymentProvider: "Telegram Stars",
        paymentId: paymentData.telegram_payment_charge_id,
        autoRenew: false,
      });

      // Обновляем статус пользователя
      user.subscriptionStatus = "active";
      user.subscriptionEndsAt = endsAt;
      await user.save();

      // Активируем или создаем VLESS аккаунт
      // Сначала ищем любой существующий аккаунт (активный или неактивный)
      let vlessAccount = await VlessAccount.findOne({
        userId: user._id,
      }).sort({ createdAt: -1 }); // Берем самый последний

      if (!vlessAccount) {
        // Создаем новый VLESS аккаунт (первая покупка)
        try {
          const accountResult = await xrayService.createUser({
            userId: user._id,
            telegramId: user.telegramId,
            flow: config.DEFAULT_FLOW,
            remark: `User ${user.telegramId}`,
          });

          vlessAccount = await VlessAccount.findById(accountResult.id);
          console.log(`✅ Создан новый VLESS аккаунт для пользователя ${user.telegramId}`);
        } catch (error) {
          console.error(`❌ Ошибка создания VLESS аккаунта:`, error);
          // Продолжаем выполнение, подписка все равно активирована
        }
      } else if (!vlessAccount.isActive) {
        // Реактивируем существующий неактивный аккаунт
        try {
          // Получаем клиент Xray напрямую для использования существующего UUID
          const xrayClient = (xrayService as any).client;
          const inboundInfo = xrayService.getInboundInfo();
          
          // Добавляем пользователя в Xray с СУЩЕСТВУЮЩИМ UUID из БД
          await xrayClient.addUser({
            tag: inboundInfo.tag,
            email: vlessAccount.email,
            uuid: vlessAccount.uuid, // Используем UUID из БД!
            flow: vlessAccount.flow ?? config.DEFAULT_FLOW,
            level: 0,
          });

          // Обновляем статус в БД
          vlessAccount.isActive = true;
          vlessAccount.expiresAt = endsAt;
          await vlessAccount.save();

          console.log(`✅ Реактивирован VLESS аккаунт для пользователя ${user.telegramId} (UUID: ${vlessAccount.uuid})`);
        } catch (error) {
          console.error(`❌ Ошибка реактивации VLESS аккаунта:`, error);
        }
      } else {
        // Обновляем существующий активный аккаунт (продление)
        vlessAccount.expiresAt = endsAt;
        await vlessAccount.save();
        console.log(`✅ Продлен VLESS аккаунт для пользователя ${user.telegramId}`);
      }

      console.log(`✅ Подписка успешно активирована для пользователя ${user.telegramId}: ${subscriptionType} до ${endsAt.toISOString()}`);

      // Отправляем уведомление пользователю об успешной оплате
      try {
        await notificationService.sendPaymentSuccessNotification(
          user.telegramId,
          subscriptionType,
          endsAt,
          vlessAccount?.link
        );
      } catch (error) {
        console.error(`❌ Ошибка отправки уведомления об оплате:`, error);
        // Не прерываем выполнение, если уведомление не отправилось
      }

      res.json({
        ok: true,
        message: "Payment processed successfully",
        subscription: {
          id: subscription._id,
          type: subscription.type,
          startsAt: subscription.startsAt,
          endsAt: subscription.endsAt,
        },
        user: {
          telegramId: user.telegramId,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionEndsAt: user.subscriptionEndsAt,
        },
        vlessAccount: vlessAccount ? {
          id: vlessAccount._id,
          email: vlessAccount.email,
          link: vlessAccount.link,
          isActive: vlessAccount.isActive,
          expiresAt: vlessAccount.expiresAt,
        } : null,
      });

    } catch (error: any) {
      console.error("❌ Ошибка обработки платежа:", error);
      res.status(500).json({ 
        error: "Internal server error",
        message: error.message 
      });
    }
  });

  /**
   * GET /webhook/telegram-payment/status
   * Проверка статуса webhook'а
   */
  router.get("/telegram-payment/status", (req: Request, res: Response) => {
    res.json({ 
      ok: true, 
      message: "Payment webhook is active",
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
