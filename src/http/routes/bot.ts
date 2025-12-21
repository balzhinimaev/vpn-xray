import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { XrayService } from "../../services/xrayService.js";
import { config } from "../../config/index.js";

export interface BotRouteOptions {
  botRegistrationSecret: string;
  xrayService: XrayService;
}

export function createBotRouter(options: BotRouteOptions) {
  const { botRegistrationSecret, xrayService } = options;
  const router = Router();

  const SUBSCRIPTION_PLANS = {
    "2weeks": { stars: 49, days: 14, type: "biweekly" as const },
    "month": { stars: 99, days: 30, type: "monthly" as const },
    "3months": { stars: 249, days: 90, type: "quarterly" as const },
  } as const;

  type StarsPeriod = keyof typeof SUBSCRIPTION_PLANS;

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

  function normalizeString(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s.length > 0 ? s : null;
  }

  function isDigits(s: string): boolean {
    return /^\d+$/.test(s);
  }

  function toIso(d: Date | undefined | null): string {
    return d ? new Date(d).toISOString() : new Date(0).toISOString();
  }

  /**
   * POST /bot/payments/stars
   * Обработать успешный платеж Telegram Stars (вызывается ботом после successful_payment)
   * Требует передачи секретного ключа бота в заголовке x-bot-secret
   */
  router.post("/payments/stars", validateBotSecret, async (req: Request, res: Response) => {
    const startedAt = Date.now();

    try {
      let telegramId: string | null = null;
      let paymentId: string | null = null;
      let providerPaymentId: string | undefined = undefined;
      let totalAmount: unknown = undefined;
      let currency: string | null = null;
      let period: StarsPeriod | null = null;
      let invoicePayload: string | null = null;

      telegramId = normalizeString((req.body as any)?.telegramId);
      paymentId = normalizeString((req.body as any)?.paymentId);
      providerPaymentId = normalizeString((req.body as any)?.providerPaymentId) ?? undefined;
      totalAmount = (req.body as any)?.totalAmount;
      currency = normalizeString((req.body as any)?.currency);
      period = normalizeString((req.body as any)?.period) as StarsPeriod | null;
      invoicePayload = normalizeString((req.body as any)?.invoicePayload);

      // strict validation
      if (!telegramId || !isDigits(telegramId)) {
        return res.status(400).json({ success: false, error: "Invalid telegramId", code: "INTERNAL_ERROR" });
      }
      if (!paymentId) {
        return res.status(400).json({ success: false, error: "paymentId is required", code: "INTERNAL_ERROR" });
      }
      if (typeof totalAmount !== "number" || !Number.isFinite(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({ success: false, error: "Invalid totalAmount", code: "INTERNAL_ERROR" });
      }
      if (currency !== "XTR") {
        return res.status(400).json({ success: false, error: "Invalid currency (expected XTR)", code: "INTERNAL_ERROR" });
      }
      if (!period || !(period in SUBSCRIPTION_PLANS)) {
        return res.status(400).json({ success: false, error: "Invalid period", code: "INTERNAL_ERROR" });
      }
      if (!invoicePayload) {
        return res.status(400).json({ success: false, error: "invoicePayload is required", code: "INTERNAL_ERROR" });
      }

      // validate invoicePayload is JSON (we store the raw string)
      try {
        JSON.parse(invoicePayload);
      } catch {
        return res.status(400).json({ success: false, error: "invoicePayload must be a valid JSON string", code: "INTERNAL_ERROR" });
      }

      const plan = SUBSCRIPTION_PLANS[period];
      if (totalAmount !== plan.stars) {
        return res.status(400).json({
          success: false,
          error: `Invalid amount for period ${period}. Expected ${plan.stars}, got ${totalAmount}`,
          code: "INVALID_AMOUNT",
        });
      }

      const { User, Subscription, VlessAccount, Payment, Referral } = await import("../../models/index.js");

      // idempotency fast-path (outside transaction)
      const existingPayment = await Payment.findOne({ telegramPaymentId: paymentId }).exec();
      if (existingPayment) {
        const subscription = existingPayment.subscriptionId
          ? await Subscription.findById(existingPayment.subscriptionId).exec()
          : await Subscription.findOne({ userId: existingPayment.userId, status: "active" }).sort({ endsAt: -1 }).exec();

        const vpnAccount = existingPayment.vpnAccountId
          ? await VlessAccount.findById(existingPayment.vpnAccountId).exec()
          : await VlessAccount.findOne({ userId: existingPayment.userId, isActive: true }).sort({ createdAt: -1 }).exec();

        return res.json({
          success: true,
          payment: {
            id: existingPayment.id,
            telegramPaymentId: existingPayment.telegramPaymentId,
            amount: existingPayment.amount,
            status: "completed",
            createdAt: toIso(existingPayment.createdAt),
          },
          subscription: subscription ? {
            id: subscription._id.toString(),
            type: subscription.type,
            status: "active",
            startsAt: toIso(subscription.startsAt),
            expiresAt: toIso(subscription.endsAt),
            daysAdded: plan.days,
          } : null,
          vpnAccount: vpnAccount ? {
            id: vpnAccount._id.toString(),
            uuid: vpnAccount.uuid,
            email: vpnAccount.email,
            link: vpnAccount.link,
            isActive: vpnAccount.isActive,
            expiresAt: toIso(vpnAccount.expiresAt),
          } : null,
        });
      }

      const session = await mongoose.startSession();
      let responseBody: any = null;

      try {
        await session.withTransaction(async () => {
          console.log("[POST /bot/payments/stars] start", {
            telegramId,
            paymentId,
            providerPaymentId: providerPaymentId ? "(provided)" : "(none)",
            totalAmount,
            currency,
            period,
          });

          const user = await User.findOne({ telegramId }).session(session).exec();
          if (!user) {
            responseBody = { success: false, error: "User not found", code: "USER_NOT_FOUND" };
            return;
          }

          const duplicate = await Payment.findOne({ telegramPaymentId: paymentId }).session(session).exec();
          if (duplicate) {
            // idempotent inside transaction too
            const subscription = duplicate.subscriptionId
              ? await Subscription.findById(duplicate.subscriptionId).session(session).exec()
              : await Subscription.findOne({ userId: user._id, status: "active" }).session(session).sort({ endsAt: -1 }).exec();

            const vpnAccount = duplicate.vpnAccountId
              ? await VlessAccount.findById(duplicate.vpnAccountId).session(session).exec()
              : await VlessAccount.findOne({ userId: user._id, isActive: true }).session(session).sort({ createdAt: -1 }).exec();

            responseBody = {
              success: true,
              payment: {
                id: duplicate.id,
                telegramPaymentId: duplicate.telegramPaymentId,
                amount: duplicate.amount,
                status: "completed",
                createdAt: toIso(duplicate.createdAt),
              },
              subscription: subscription ? {
                id: subscription._id.toString(),
                type: subscription.type,
                status: "active",
                startsAt: toIso(subscription.startsAt),
                expiresAt: toIso(subscription.endsAt),
                daysAdded: plan.days,
              } : null,
              vpnAccount: vpnAccount ? {
                id: vpnAccount._id.toString(),
                uuid: vpnAccount.uuid,
                email: vpnAccount.email,
                link: vpnAccount.link,
                isActive: vpnAccount.isActive,
                expiresAt: toIso(vpnAccount.expiresAt),
              } : null,
            };
            return;
          }

          const now = new Date();
          const activeSubscription = await Subscription.findOne({
            userId: user._id,
            status: "active",
            endsAt: { $gt: now },
          }).session(session).sort({ endsAt: -1 }).exec();

          const base = activeSubscription?.endsAt && activeSubscription.endsAt > now
            ? new Date(activeSubscription.endsAt)
            : now;

          const startsAt = activeSubscription?.startsAt ?? new Date(base);
          const endsAt = new Date(base);
          endsAt.setDate(endsAt.getDate() + plan.days);

          const paymentDoc = await Payment.create([{
            id: uuidv4(),
            userId: user._id,
            telegramId: user.telegramId,
            telegramPaymentId: paymentId,
            providerPaymentId,
            amount: totalAmount,
            currency: "XTR",
            type: "telegram_stars",
            status: "completed",
            period,
            metadata: invoicePayload,
          }], { session }).then((arr) => arr[0]);

          let subscription = activeSubscription;
          if (subscription) {
            subscription.endsAt = endsAt;
            subscription.status = "active";
            subscription.type = plan.type;
            await subscription.save({ session });
          } else {
            subscription = await Subscription.create([{
              userId: user._id,
              telegramId: user.telegramId,
              type: plan.type,
              status: "active",
              startsAt,
              endsAt,
              price: totalAmount,
              currency: "XTR",
              paymentProvider: "Telegram Stars",
              paymentId: paymentId,
              autoRenew: false,
            }], { session }).then((arr) => arr[0]);
          }

        // update user premium status
        user.subscriptionStatus = "active";
        user.subscriptionEndsAt = endsAt;
        await user.save({ session });

        // ensure/activate vpn account
        let vpnAccount = await VlessAccount.findOne({ userId: user._id }).session(session).sort({ createdAt: -1 }).exec();

        if (!vpnAccount) {
          // this will call Xray and then create VlessAccount doc in this transaction
          const created = await xrayService.createUser(
            {
              userId: user._id,
              telegramId: user.telegramId,
              flow: config.DEFAULT_FLOW,
              remark: user.username ? `@${user.username}` : `User ${user.telegramId}`,
            },
            { session, expiresAt: endsAt }
          );
          vpnAccount = await VlessAccount.findById(created.id).session(session).exec();
        } else if (!vpnAccount.isActive) {
          // reactivate in Xray using existing UUID/email, then update db in tx
          try {
            const xrayClient = (xrayService as any).client;
            const inboundInfo = xrayService.getInboundInfo();

            await xrayClient.addUser({
              tag: inboundInfo.tag,
              email: vpnAccount.email,
              uuid: vpnAccount.uuid,
              flow: vpnAccount.flow ?? config.DEFAULT_FLOW,
              level: 0,
            });

            vpnAccount.isActive = true;
          } catch (e: any) {
            console.error("[POST /bot/payments/stars] failed to reactivate VLESS in Xray:", e?.message || e);
          }

          vpnAccount.expiresAt = endsAt;
          await vpnAccount.save({ session });
        } else {
          vpnAccount.expiresAt = endsAt;
          await vpnAccount.save({ session });
        }

        // link payment -> subscription/vpn for deterministic idempotent response
        paymentDoc.subscriptionId = subscription!._id;
        paymentDoc.vpnAccountId = vpnAccount?._id;
        await paymentDoc.save({ session });

        // referral bonus on first payment (safe: only if referral record exists and bonus not granted yet)
        const previousPaymentsCount = await Payment.countDocuments({ userId: user._id }).session(session).exec();
        const isFirstPayment = previousPaymentsCount === 1; // includes current paymentDoc
        if (isFirstPayment && user.referredBy) {
          const ref = await Referral.findOne({ referredTelegramId: user.telegramId }).session(session).exec();
          if (ref && !ref.bonusGranted) {
            const bonusDays = config.REFERRAL_BONUS_DAYS || 1;
            const bonusMs = bonusDays * 24 * 60 * 60 * 1000;

            const referrer = await User.findOne({ telegramId: user.referredBy }).session(session).exec();
            if (referrer) {
              const refBase = (referrer.subscriptionStatus === "active" && referrer.subscriptionEndsAt && referrer.subscriptionEndsAt > now)
                ? new Date(referrer.subscriptionEndsAt)
                : now;

              referrer.subscriptionStatus = "active";
              referrer.subscriptionEndsAt = new Date(refBase.getTime() + bonusMs);
              referrer.referralBonusDays = (referrer.referralBonusDays || 0) + bonusDays;
              await referrer.save({ session });

              // mark bonus granted
              ref.bonusGranted = true;
              ref.bonusGrantedAt = new Date();
              ref.bonusDays = bonusDays;
              await ref.save({ session });
            }
          }
        }

        responseBody = {
          success: true,
          payment: {
            id: paymentDoc.id,
            telegramPaymentId: paymentDoc.telegramPaymentId,
            amount: paymentDoc.amount,
            status: "completed",
            createdAt: toIso(paymentDoc.createdAt),
          },
          subscription: {
            id: subscription!._id.toString(),
            type: subscription!.type,
            status: "active",
            startsAt: toIso(subscription!.startsAt),
            expiresAt: toIso(subscription!.endsAt),
            daysAdded: plan.days,
          },
          vpnAccount: vpnAccount ? {
            id: vpnAccount._id.toString(),
            uuid: vpnAccount.uuid,
            email: vpnAccount.email,
            link: vpnAccount.link,
            isActive: vpnAccount.isActive,
            expiresAt: toIso(vpnAccount.expiresAt),
          } : null,
        };
        });
      } finally {
        await session.endSession();
      }

      if (!responseBody) {
        return res.status(500).json({ success: false, error: "Internal error", code: "INTERNAL_ERROR" });
      }
      if (responseBody.success === false) {
        const status = responseBody.code === "USER_NOT_FOUND" ? 404 : 400;
        return res.status(status).json(responseBody);
      }

      console.log("[POST /bot/payments/stars] ok", {
        telegramId,
        paymentId,
        ms: Date.now() - startedAt,
      });

      return res.json(responseBody);
    } catch (error: any) {
      // Handle concurrent duplicate requests (unique index on telegramPaymentId)
      if ((error?.code === 11000 || error?.message?.includes?.("E11000")) && (req.body as any)?.paymentId) {
        try {
          const { Subscription, VlessAccount, Payment } = await import("../../models/index.js");
          const paymentId = normalizeString((req.body as any)?.paymentId);
          const period = normalizeString((req.body as any)?.period) as StarsPeriod | null;
          const plan = period && (period in SUBSCRIPTION_PLANS) ? SUBSCRIPTION_PLANS[period] : null;

          if (paymentId) {
            const existingPayment = await Payment.findOne({ telegramPaymentId: paymentId }).exec();
            if (existingPayment) {
              const subscription = existingPayment.subscriptionId
                ? await Subscription.findById(existingPayment.subscriptionId).exec()
                : await Subscription.findOne({ userId: existingPayment.userId, status: "active" }).sort({ endsAt: -1 }).exec();

              const vpnAccount = existingPayment.vpnAccountId
                ? await VlessAccount.findById(existingPayment.vpnAccountId).exec()
                : await VlessAccount.findOne({ userId: existingPayment.userId, isActive: true }).sort({ createdAt: -1 }).exec();

              return res.json({
                success: true,
                payment: {
                  id: existingPayment.id,
                  telegramPaymentId: existingPayment.telegramPaymentId,
                  amount: existingPayment.amount,
                  status: "completed",
                  createdAt: toIso(existingPayment.createdAt),
                },
                subscription: subscription ? {
                  id: subscription._id.toString(),
                  type: subscription.type,
                  status: "active",
                  startsAt: toIso(subscription.startsAt),
                  expiresAt: toIso(subscription.endsAt),
                  daysAdded: plan?.days ?? 0,
                } : null,
                vpnAccount: vpnAccount ? {
                  id: vpnAccount._id.toString(),
                  uuid: vpnAccount.uuid,
                  email: vpnAccount.email,
                  link: vpnAccount.link,
                  isActive: vpnAccount.isActive,
                  expiresAt: toIso(vpnAccount.expiresAt),
                } : null,
              });
            }
          }
        } catch (e) {
          console.error("[POST /bot/payments/stars] duplicate handler failed:", e);
        }
      }

      console.error("[POST /bot/payments/stars] error:", error);
      return res.status(500).json({ success: false, error: error.message || "Internal error", code: "INTERNAL_ERROR" });
    }
  });

  /**
   * GET /bot/check-user/:telegramId
   * Проверить существование пользователя по telegramId
   * Требует передачи секретного ключа бота в заголовке x-bot-secret или параметре secret
   */
  router.get("/check-user/:telegramId", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: telegramId.toString() });

      res.json({
        exists: !!user,
        telegramId: telegramId.toString(),
        userId: user?._id || null,
      });
    } catch (error: any) {
      console.error("[GET /bot/check-user/:telegramId] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

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

  /**
   * GET /bot/user/:telegramId/referrals
   * Получить статистику рефералов пользователя
   */
  router.get("/user/:telegramId/referrals", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User, Referral } = await import("../../models/index.js");

      const user = await User.findOne({ telegramId: telegramId.toString() });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Получаем список рефералов
      const referrals = await Referral.find({
        referrerTelegramId: telegramId.toString(),
      })
        .sort({ createdAt: -1 })
        .populate("referredId", "telegramId username firstName lastName isPremium subscriptionStatus createdAt")
        .exec();

      // Подсчитываем статистику
      const totalReferrals = referrals.length;
      const activeReferrals = referrals.filter(r => r.isActive).length;
      const totalBonusTrafficMB = referrals.reduce((sum, r) => sum + (r.bonusTrafficMB || 0), 0);
      const totalBonusDays = referrals.reduce((sum, r) => sum + (r.bonusDays || 0), 0);

      res.json({
        user: {
          telegramId: user.telegramId,
          referralCode: user.referralCode,
          referralCount: user.referralCount,
          referralBonusTrafficMB: Math.round((user.referralBonusTrafficBytes || 0) / 1024 / 1024),
          referralBonusDays: user.referralBonusDays,
        },
        stats: {
          totalReferrals,
          activeReferrals,
          totalBonusTrafficMB,
          totalBonusDays,
        },
        referrals: referrals.map(r => ({
          id: r._id,
          referredUser: {
            telegramId: (r.referredId as any)?.telegramId,
            username: (r.referredId as any)?.username,
            firstName: (r.referredId as any)?.firstName,
            lastName: (r.referredId as any)?.lastName,
            isPremium: (r.referredId as any)?.isPremium,
            subscriptionStatus: (r.referredId as any)?.subscriptionStatus,
          },
          bonusGranted: r.bonusGranted,
          bonusType: r.bonusType,
          bonusTrafficMB: r.bonusTrafficMB,
          bonusDays: r.bonusDays,
          bonusGrantedAt: r.bonusGrantedAt,
          isActive: r.isActive,
          createdAt: r.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("[GET /bot/user/:telegramId/referrals] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * GET /bot/user/:telegramId/referral-code
   * Получить только реферальный код пользователя
   */
  router.get("/user/:telegramId/referral-code", validateBotSecret, async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.params;

      if (!telegramId) {
        return res.status(400).json({ error: "telegramId is required" });
      }

      const { User, generateReferralCode } = await import("../../models/index.js");

      let user = await User.findOne({ telegramId: telegramId.toString() });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Генерируем реферальный код, если его еще нет
      if (!user.referralCode) {
        user.referralCode = generateReferralCode(user.telegramId);
        await user.save();
      }

      res.json({
        telegramId: user.telegramId,
        referralCode: user.referralCode,
        referralLink: `https://t.me/${process.env.BOT_USERNAME || 'vpnbot'}?start=${user.referralCode}`,
        referralCount: user.referralCount || 0,
      });
    } catch (error: any) {
      console.error("[GET /bot/user/:telegramId/referral-code] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  return router;
}
