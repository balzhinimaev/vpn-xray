import { Router, Request, Response } from "express";

export interface BotRouteOptions {
  botRegistrationSecret: string;
}

export function createBotRouter(options: BotRouteOptions) {
  const { botRegistrationSecret } = options;
  const router = Router();

  /**
   * Middleware для проверки секрета бота
   */
  const validateBotSecret = (req: Request, res: Response, next: any) => {
    const secret = req.headers['x-bot-secret'] || req.query.secret;
    if (!secret || secret !== botRegistrationSecret) {
      return res.status(401).json({ error: "Invalid bot secret" });
    }
    next();
  };

  /**
   * GET /bot/user/:telegramId
   * Получить данные пользователя по telegramId (для телеграм бота)
   * Требует передачи секретного ключа бота в заголовке x-bot-secret или параметре secret
   */
  router.get("/user/:telegramId", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User, VlessAccount, Subscription } = await import("../../models/index.js");

      // Находим пользователя
      const user = await User.findOne({ telegramId: telegramId.toString() });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Получаем активный VPN аккаунт (у пользователя должен быть только один оплаченный)
      const activeAccount = await VlessAccount.findOne({
        userId: user._id,
        isActive: true,
      }).sort({ createdAt: -1 }); // берем самый последний, если их несколько

      // Получаем активную подписку
      const activeSubscription = await Subscription.findOne({
        userId: user._id,
        status: "active",
      }).sort({ endsAt: -1 });

      // Вычисляем оставшееся время
      const now = new Date();
      let timeLeft = null;

      if (user.subscriptionStatus === "trial" && user.trialEndsAt) {
        const hoursLeft = Math.max(
          0,
          Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60))
        );
        timeLeft = {
          type: "hours",
          value: hoursLeft,
          expiresAt: user.trialEndsAt,
        };
      } else if (user.subscriptionStatus === "active" && user.subscriptionEndsAt) {
        const daysLeft = Math.max(
          0,
          Math.ceil((user.subscriptionEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );
        timeLeft = {
          type: "days",
          value: daysLeft,
          expiresAt: user.subscriptionEndsAt,
        };
      }

      // Подготавливаем информацию о трафике для триальных пользователей
      let trialTraffic = null;
      if (user.subscriptionStatus === "trial") {
        const { config } = await import("../../config/index.js");
        const trialTrafficLimit = user.trialTrafficLimitBytes || config.TRIAL_TRAFFIC_LIMIT_BYTES;
        const trialTrafficUsed = user.trialTrafficUsedBytes || 0;
        const trialTrafficRemaining = Math.max(0, trialTrafficLimit - trialTrafficUsed);
        const trialTrafficUsedPercent = Math.round((trialTrafficUsed / trialTrafficLimit) * 100);

        trialTraffic = {
          limitMB: Math.round(trialTrafficLimit / 1024 / 1024),
          usedMB: parseFloat((trialTrafficUsed / 1024 / 1024).toFixed(2)),
          remainingMB: parseFloat((trialTrafficRemaining / 1024 / 1024).toFixed(2)),
          usedPercent: trialTrafficUsedPercent,
        };
      }

      // Формируем ответ
      const response: any = {
        user: {
          id: user._id,
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          isPremium: user.isPremium,
          isBlocked: user.isBlocked,
        },
        subscription: {
          status: user.subscriptionStatus,
          type: activeSubscription?.type || null,
          timeLeft,
          trialTraffic,
        },
        vpnAccount: activeAccount ? {
          id: activeAccount._id,
          email: activeAccount.email,
          uuid: activeAccount.uuid,
          link: activeAccount.link,
          isActive: activeAccount.isActive,
          expiresAt: activeAccount.expiresAt,
          createdAt: activeAccount.createdAt,
        } : null,
      };

      res.json(response);
    } catch (error: any) {
      console.error("[GET /bot/user/:telegramId] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * GET /bot/user/:telegramId/subscription
   * Получить только статус подписки пользователя
   */
  router.get("/user/:telegramId/subscription", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User, Subscription } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: telegramId.toString() });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const activeSubscription = await Subscription.findOne({
        userId: user._id,
        status: "active",
      }).sort({ endsAt: -1 });

      const now = new Date();
      let timeLeft = null;

      if (user.subscriptionStatus === "trial" && user.trialEndsAt) {
        const hoursLeft = Math.max(
          0,
          Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60))
        );
        timeLeft = {
          type: "hours",
          value: hoursLeft,
          expiresAt: user.trialEndsAt,
        };
      } else if (user.subscriptionStatus === "active" && user.subscriptionEndsAt) {
        const daysLeft = Math.max(
          0,
          Math.ceil((user.subscriptionEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );
        timeLeft = {
          type: "days",
          value: daysLeft,
          expiresAt: user.subscriptionEndsAt,
        };
      }

      let trialTraffic = null;
      if (user.subscriptionStatus === "trial") {
        const { config } = await import("../../config/index.js");
        const trialTrafficLimit = user.trialTrafficLimitBytes || config.TRIAL_TRAFFIC_LIMIT_BYTES;
        const trialTrafficUsed = user.trialTrafficUsedBytes || 0;
        const trialTrafficRemaining = Math.max(0, trialTrafficLimit - trialTrafficUsed);
        const trialTrafficUsedPercent = Math.round((trialTrafficUsed / trialTrafficLimit) * 100);

        trialTraffic = {
          limitMB: Math.round(trialTrafficLimit / 1024 / 1024),
          usedMB: parseFloat((trialTrafficUsed / 1024 / 1024).toFixed(2)),
          remainingMB: parseFloat((trialTrafficRemaining / 1024 / 1024).toFixed(2)),
          usedPercent: trialTrafficUsedPercent,
        };
      }

      res.json({
        status: user.subscriptionStatus,
        type: activeSubscription?.type || null,
        timeLeft,
        trialTraffic,
        isPaid: user.subscriptionStatus === "active",
        isTrial: user.subscriptionStatus === "trial",
        isExpired: user.subscriptionStatus === "expired",
      });
    } catch (error: any) {
      console.error("[GET /bot/user/:telegramId/subscription] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * GET /bot/user/:telegramId/vpn
   * Получить только данные VPN аккаунта пользователя
   */
  router.get("/user/:telegramId/vpn", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User, VlessAccount } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: telegramId.toString() });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // У пользователя должен быть только один активный оплаченный VPN
      const activeAccount = await VlessAccount.findOne({
        userId: user._id,
        isActive: true,
      }).sort({ createdAt: -1 });

      if (!activeAccount) {
        return res.status(404).json({ 
          error: "No active VPN account found",
          hasAccount: false,
        });
      }

      res.json({
        hasAccount: true,
        vpnAccount: {
          id: activeAccount._id,
          email: activeAccount.email,
          uuid: activeAccount.uuid,
          link: activeAccount.link,
          isActive: activeAccount.isActive,
          expiresAt: activeAccount.expiresAt,
          createdAt: activeAccount.createdAt,
        },
      });
    } catch (error: any) {
      console.error("[GET /bot/user/:telegramId/vpn] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  return router;
}

