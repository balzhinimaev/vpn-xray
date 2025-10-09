import { Router, Request, Response } from "express";
import { JWTService } from "../../auth/jwtService.js";
import { createTelegramInitDataValidator } from "../../auth/telegramAuth.js";
import { findOrCreateUser } from "../../models/index.js";
import { Session } from "../../models/index.js";

export interface AuthRouteOptions {
  jwtService: JWTService;
  botToken: string;
  requireAuth?: (req: Request, res: Response, next: any) => void;
}

export function createAuthRouter(options: AuthRouteOptions) {
  const { jwtService, botToken, requireAuth } = options;
  const router = Router();

  const validateInitData = createTelegramInitDataValidator(botToken);

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
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней
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
