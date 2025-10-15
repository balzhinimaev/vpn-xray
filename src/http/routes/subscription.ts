import { Router, Request, Response } from "express";
import { XrayService } from "../../services/xrayService.js";
import { config } from "../../config/index.js";

export interface SubscriptionRouteOptions {
  requireAuth: (req: Request, res: Response, next: any) => void;
  xrayService: XrayService;
}

export function createSubscriptionRouter(
  options: SubscriptionRouteOptions
) {
  const { requireAuth, xrayService } = options;
  const router = Router();

  /**
   * GET /api/subscription/status
   * Получить статус подписки текущего пользователя
   */
  router.get("/status", requireAuth, async (req: any, res: Response) => {
    try {
      const { User, Subscription, VlessAccount } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: req.telegramId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Получаем активные подписки
      const activeSubscriptions = await Subscription.find({
        userId: user._id,
        status: "active",
      }).sort({ endsAt: -1 });

      // Получаем историю подписок
      const subscriptionHistory = await Subscription.find({
        userId: user._id,
      })
        .sort({ createdAt: -1 })
        .limit(10);

      // Проверяем активные аккаунты
      const activeAccounts = await VlessAccount.countDocuments({
        userId: user._id,
        isActive: true,
      });

      const now = new Date();
      let daysLeft = 0;
      let hoursLeft = 0;
      let expiresAt = null;

      if (user.subscriptionStatus === "trial" && user.trialEndsAt) {
        expiresAt = user.trialEndsAt;
        hoursLeft = Math.max(
          0,
          Math.ceil(
            (user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60)
          )
        );
      } else if (
        user.subscriptionStatus === "active" &&
        user.subscriptionEndsAt
      ) {
        expiresAt = user.subscriptionEndsAt;
        daysLeft = Math.max(
          0,
          Math.ceil(
            (user.subscriptionEndsAt.getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      res.json({
        status: user.subscriptionStatus,
        expiresAt,
        daysLeft,
        hoursLeft,
        activeAccounts,
        trialEndsAt: user.trialEndsAt,
        subscriptionEndsAt: user.subscriptionEndsAt,
        activeSubscriptions: activeSubscriptions.map((sub) => ({
          id: sub._id,
          type: sub.type,
          startsAt: sub.startsAt,
          endsAt: sub.endsAt,
          autoRenew: sub.autoRenew,
        })),
        history: subscriptionHistory.map((sub) => ({
          id: sub._id,
          type: sub.type,
          status: sub.status,
          startsAt: sub.startsAt,
          endsAt: sub.endsAt,
          price: sub.price,
          currency: sub.currency,
          createdAt: sub.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("[GET /api/subscription/status] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * POST /api/subscription/extend
   * Продлить подписку (после оплаты)
   */
  router.post("/extend", requireAuth, async (req: any, res: Response) => {
    try {
      const {
        type = "monthly",
        paymentProvider,
        paymentId,
        price,
        currency = "RUB",
      } = req.body;

      const { User, Subscription, VlessAccount } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: req.telegramId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Вычисляем период подписки
      let subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS;
      if (type === "quarterly") {
        subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS * 3;
      } else if (type === "yearly") {
        subscriptionDays = config.SUBSCRIPTION_MONTHLY_DAYS * 12;
      }

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

      // Создаем запись о подписке
      const subscription = await Subscription.create({
        userId: user._id,
        telegramId: user.telegramId,
        type,
        status: "active",
        startsAt,
        endsAt,
        price: price || 0,
        currency,
        paymentProvider,
        paymentId,
        autoRenew: false,
      });

      // Обновляем статус пользователя
      user.subscriptionStatus = "active";
      user.subscriptionEndsAt = endsAt;
      await user.save();

      // Активируем VLESS аккаунты, если они были деактивированы
      const inactiveAccounts = await VlessAccount.find({
        userId: user._id,
        isActive: false,
      });

      for (const account of inactiveAccounts) {
        // Реактивируем аккаунт в Xray
        try {
          await xrayService.createAdminUser({
            email: account.email,
            flow: account.flow ?? undefined,
            remark: account.remark ?? undefined,
          });
          
          account.isActive = true;
          account.expiresAt = endsAt;
          await account.save();
          
          console.log(`[POST /api/subscription/extend] Reactivated account ${account.email}`);
        } catch (err) {
          console.error(
            `[POST /api/subscription/extend] Failed to reactivate account ${account.email}:`,
            err
          );
        }
      }

      // Обновляем expiresAt для всех активных аккаунтов
      await VlessAccount.updateMany(
        { userId: user._id, isActive: true },
        { $set: { expiresAt: endsAt } }
      );

      res.json({
        ok: true,
        message: "Subscription extended successfully",
        subscription: {
          id: subscription._id,
          type: subscription.type,
          startsAt: subscription.startsAt,
          endsAt: subscription.endsAt,
        },
        user: {
          subscriptionStatus: user.subscriptionStatus,
          subscriptionEndsAt: user.subscriptionEndsAt,
        },
      });
    } catch (error: any) {
      console.error("[POST /api/subscription/extend] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * POST /api/subscription/cancel
   * Отменить автопродление подписки
   */
  router.post("/cancel", requireAuth, async (req: any, res: Response) => {
    try {
      const { User, Subscription } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: req.telegramId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Находим активные подписки с автопродлением
      await Subscription.updateMany(
        { userId: user._id, status: "active", autoRenew: true },
        {
          $set: {
            autoRenew: false,
            cancelledAt: new Date(),
            cancelReason: req.body.reason || "User requested",
          },
        }
      );

      res.json({
        ok: true,
        message: "Auto-renewal cancelled",
      });
    } catch (error: any) {
      console.error("[POST /api/subscription/cancel] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * GET /api/subscription/plans
   * Получить доступные планы подписки
   */
  router.get("/plans", requireAuth, async (req: any, res: Response) => {
    try {
      // Здесь можно добавить динамические цены из БД или конфига
      const plans = [
        {
          id: "monthly",
          name: "Месячная подписка",
          duration: config.SUBSCRIPTION_MONTHLY_DAYS,
          durationUnit: "days",
          price: 299,
          currency: "RUB",
          features: [
            "Безлимитный трафик",
            "Высокая скорость",
            "Поддержка 24/7",
            "До 5 устройств",
          ],
        },
        {
          id: "quarterly",
          name: "Квартальная подписка",
          duration: config.SUBSCRIPTION_MONTHLY_DAYS * 3,
          durationUnit: "days",
          price: 799,
          currency: "RUB",
          discount: 10,
          features: [
            "Безлимитный трафик",
            "Высокая скорость",
            "Поддержка 24/7",
            "До 5 устройств",
            "Скидка 10%",
          ],
        },
        {
          id: "yearly",
          name: "Годовая подписка",
          duration: config.SUBSCRIPTION_MONTHLY_DAYS * 12,
          durationUnit: "days",
          price: 2999,
          currency: "RUB",
          discount: 20,
          features: [
            "Безлимитный трафик",
            "Высокая скорость",
            "Поддержка 24/7",
            "До 5 устройств",
            "Скидка 20%",
            "Приоритетная поддержка",
          ],
        },
      ];

      res.json({ plans });
    } catch (error: any) {
      console.error("[GET /api/subscription/plans] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  return router;
}

