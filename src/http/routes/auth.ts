import { Router, Request, Response } from "express";
import { JWTService } from "../../auth/jwtService.js";
import { createTelegramInitDataValidator } from "../../auth/telegramAuth.js";
import { findOrCreateUser, generateReferralCode, createReferral } from "../../models/index.js";
import { Session } from "../../models/index.js";
import { XrayService } from "../../services/xrayService.js";
import { config } from "../../config/index.js";

export interface AuthRouteOptions {
  jwtService: JWTService;
  xrayService: XrayService;
  botToken: string;
  botRegistrationSecret: string;
  requireAuth?: (req: Request, res: Response, next: any) => void;
}

export function createAuthRouter(options: AuthRouteOptions) {
  const { jwtService, xrayService, botToken, botRegistrationSecret, requireAuth } = options;
  const router = Router();

  const validateInitData = createTelegramInitDataValidator(botToken);

  /**
   * Middleware для проверки секрета регистрации бота
   */
  const validateBotSecret = (req: Request, res: Response, next: any) => {
    const secret = req.headers['x-bot-secret'] || req.body?.secret;
    if (!secret || secret !== botRegistrationSecret) {
      return res.status(401).json({ error: "Invalid bot registration secret" });
    }
    next();
  };

  /**
   * POST /auth/telegram
   * Авторизация через Telegram initData
   */
  router.post(
    "/telegram",
    validateInitData,
    async (req: any, res: Response) => {
      try {
        const telegramUser = req.telegramUser;
        if (!telegramUser || !telegramUser.id) {
          return res.status(400).json({ error: "Invalid telegram user data" });
        }

        // Найти или создать пользователя
        const user = await findOrCreateUser(telegramUser);

        if (user.isBlocked) {
          return res.status(403).json({ error: "User is blocked" });
        }

        // Генерируем токены
        const { accessToken, refreshToken } = jwtService.generateTokenPair(
          user._id,
          user.telegramId
        );

        // Сохраняем refresh token в БД
        const expiresAt = jwtService.getRefreshExpiresAt();
        await Session.create({
          userId: user._id,
          telegramId: user.telegramId,
          refreshToken,
          expiresAt,
          deviceInfo: req.headers["user-agent"] || "unknown",
        });

        res.json({
          accessToken,
          refreshToken,
          user: {
            id: user._id,
            telegramId: user.telegramId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            isPremium: user.isPremium,
          },
        });
      } catch (error: any) {
        console.error("[POST /auth/telegram] error:", error);
        res.status(500).json({ error: error.message || "Internal error" });
      }
    }
  );

  /**
   * POST /auth/bot-register
   * Регистрация пользователя напрямую из Telegram бота
   * Автоматически создает VLESS аккаунт для нового пользователя
   */
  router.post(
    "/bot-register",
    validateBotSecret,
    async (req: Request, res: Response) => {
      try {
        const { telegramId, username, firstName, lastName, languageCode, isPremium, referralCode } = req.body;

        if (!telegramId) {
          return res.status(400).json({ error: "telegramId is required" });
        }

        // Создаем payload для findOrCreateUser
        const telegramUserPayload = {
          id: telegramId,
          username,
          first_name: firstName,
          last_name: lastName,
          language_code: languageCode,
          is_premium: isPremium || false,
        };

        console.log("[POST /auth/bot-register] Processing registration for telegramId:", telegramId);
        if (referralCode) {
          console.log("[POST /auth/bot-register] Referral code provided:", referralCode);
        }
        
        // Проверим, существует ли пользователь (чтобы определить, нужно ли создавать VLESS)
        const { User, VlessAccount, Subscription, NotificationLog } = await import("../../models/index.js");
        const existingUser = await User.findOne({ telegramId: telegramId.toString() });
        const isNewUser = !existingUser;
        
        console.log("[POST /auth/bot-register] User status:", isNewUser ? "NEW USER" : "EXISTING USER");
        
        // Найти или создать пользователя
        const user = await findOrCreateUser(telegramUserPayload);
        
        // Генерируем реферальный код для нового пользователя
        if (isNewUser && !user.referralCode) {
          user.referralCode = generateReferralCode(user.telegramId);
          await user.save();
          console.log(`[POST /auth/bot-register] Generated referral code: ${user.referralCode}`);
        }
        
        // Устанавливаем тестовый период для нового пользователя
        if (isNewUser && !user.trialEndsAt) {
          const trialEndsAt = new Date();
          trialEndsAt.setHours(trialEndsAt.getHours() + config.TRIAL_PERIOD_HOURS);
          
          user.subscriptionStatus = "trial";
          user.trialEndsAt = trialEndsAt;
          user.trialTrafficLimitBytes = config.TRIAL_TRAFFIC_LIMIT_BYTES;
          user.trialTrafficUsedBytes = 0;
          await user.save();
          
          // Создаем запись о тестовой подписке
          await Subscription.create({
            userId: user._id,
            telegramId: user.telegramId,
            type: "trial",
            status: "active",
            startsAt: new Date(),
            endsAt: trialEndsAt,
            price: 0,
            currency: "RUB",
          });
          
          console.log(`[POST /auth/bot-register] Trial period set until ${trialEndsAt.toISOString()}`);
          console.log(`[POST /auth/bot-register] Trial traffic limit: ${config.TRIAL_TRAFFIC_LIMIT_MB}MB`);
        }
        
        // Обработка реферального кода (только для новых пользователей)
        let referralResult = null;
        if (isNewUser && referralCode) {
          console.log(`[POST /auth/bot-register] Processing referral code: ${referralCode}`);
          referralResult = await createReferral(user.telegramId, referralCode, {
            bonusTrafficMB: config.REFERRAL_BONUS_TRAFFIC_MB,
            bonusDays: config.REFERRAL_BONUS_DAYS,
            bonusType: config.REFERRAL_BONUS_TYPE,
          });
          
          if (referralResult.success) {
            console.log(`[POST /auth/bot-register] Referral successfully processed`);
          } else {
            console.warn(`[POST /auth/bot-register] Referral processing failed: ${referralResult.error}`);
          }
        }
        
        console.log("[POST /auth/bot-register] User found/created:", {
          id: user._id,
          telegramId: user.telegramId,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        });

        if (user.isBlocked) {
          return res.status(403).json({ error: "User is blocked" });
        }

        // Генерируем токены
        const { accessToken, refreshToken } = jwtService.generateTokenPair(
          user._id,
          user.telegramId
        );

        // Сохраняем refresh token в БД
        const expiresAt = jwtService.getRefreshExpiresAt();
        await Session.create({
          userId: user._id,
          telegramId: user.telegramId,
          refreshToken,
          expiresAt,
          deviceInfo: req.headers["user-agent"] || "telegram-bot",
        });

        // Проверяем, есть ли у пользователя хотя бы один активный VLESS аккаунт
        const existingAccounts = await VlessAccount.countDocuments({
          userId: user._id,
          isActive: true,
        });

        let vlessAccount = null;

        // Если у пользователя нет активных аккаунтов, создаем первый
        if (existingAccounts === 0) {
          try {
            console.log("[POST /auth/bot-register] Creating VLESS account for new user");
            
            const vlessResult = await xrayService.createUser({
              userId: user._id,
              telegramId: user.telegramId,
              remark: username ? `@${username}` : `User ${telegramId}`,
            });

            vlessAccount = {
              id: vlessResult.id,
              uuid: vlessResult.uuid,
              email: vlessResult.email,
              link: vlessResult.link,
              port: vlessResult.port,
              security: vlessResult.security,
              expiresAt: vlessResult.expiresAt,
            };

            console.log("[POST /auth/bot-register] VLESS account created:", vlessAccount.id);
            
            // Логируем приветственное уведомление для нового пользователя
            if (isNewUser) {
              await NotificationLog.create({
                userId: user._id,
                telegramId: user.telegramId,
                type: "trial_welcome",
                sentAt: new Date(),
                success: true,
                metadata: {
                  trialHours: config.TRIAL_PERIOD_HOURS,
                  vlessAccountId: vlessAccount.id,
                },
              }).catch((err) => {
                console.error("[POST /auth/bot-register] Failed to log welcome notification:", err);
              });
            }
          } catch (vlessError: any) {
            console.error("[POST /auth/bot-register] Failed to create VLESS account:", vlessError);
            // Не прерываем регистрацию из-за ошибки создания VLESS
            // Пользователь сможет создать аккаунт позже
          }
        } else {
          console.log(`[POST /auth/bot-register] User already has ${existingAccounts} active account(s)`);
        }

        res.json({
          accessToken,
          refreshToken,
          user: {
            id: user._id,
            telegramId: user.telegramId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            isPremium: user.isPremium,
            telegram_min_app_opened: user.telegram_min_app_opened,
            subscriptionStatus: user.subscriptionStatus,
            trialEndsAt: user.trialEndsAt,
            subscriptionEndsAt: user.subscriptionEndsAt,
            referralCode: user.referralCode, // Реферальный код пользователя
            referredBy: user.referredBy, // telegramId реферера
            referralCount: user.referralCount, // Количество рефералов
          },
          vlessAccount, // null если аккаунт уже был или произошла ошибка
          referral: referralResult ? {
            success: referralResult.success,
            error: referralResult.error,
          } : null,
        });
      } catch (error: any) {
        console.error("[POST /auth/bot-register] error:", error);
        res.status(500).json({ error: error.message || "Internal error" });
      }
    }
  );

  /**
   * POST /auth/refresh
   * Обновление токенов по refresh token
   */
  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: "refreshToken is required" });
      }

      // Проверяем refresh token
      const payload = jwtService.verifyRefreshToken(refreshToken);

      // Проверяем существование сессии в БД
      const session = await Session.findOne({
        refreshToken,
        telegramId: payload.telegramId,
      }).populate("userId");

      if (!session) {
        return res.status(401).json({ error: "Invalid refresh token" });
      }

      if (session.expiresAt < new Date()) {
        await session.deleteOne();
        return res.status(401).json({ error: "Refresh token expired" });
      }

      // Генерируем новую пару токенов
      const { accessToken, refreshToken: newRefreshToken } =
        jwtService.generateTokenPair(session.userId, session.telegramId);

      // Обновляем refresh token в БД
      session.refreshToken = newRefreshToken;
      session.lastActivity = new Date();
      await session.save();

      res.json({
        accessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error: any) {
      console.error("[POST /auth/refresh] error:", error);
      res.status(401).json({ error: error.message || "Invalid refresh token" });
    }
  });

  /**
   * POST /auth/logout
   * Выход (удаление сессии)
   */
  router.post("/logout", requireAuth!, async (req: any, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(400).json({ error: "Authorization header required" });
      }

      // Удаляем все сессии пользователя (опционально: только текущую)
      await Session.deleteMany({ telegramId: req.telegramId });

      res.json({ ok: true, message: "Logged out successfully" });
    } catch (error: any) {
      console.error("[POST /auth/logout] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * GET /auth/me
   * Получить информацию о текущем пользователе
   */
  router.get("/me", requireAuth!, async (req: any, res: Response) => {
    try {
      const { User, VlessAccount } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: req.telegramId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const accountsCount = await VlessAccount.countDocuments({
        userId: user._id,
        isActive: true,
      });

      res.json({
        id: user._id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
        isPremium: user.isPremium,
        accountsCount,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      console.error("[GET /auth/me] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  return router;
}
