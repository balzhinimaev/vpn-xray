import { Types } from "mongoose";
import {
  User,
  VlessAccount,
  Subscription,
  NotificationLog,
} from "../models/index.js";
import { XrayService } from "./xrayService.js";
import { config } from "../config/index.js";

export interface SubscriptionSchedulerOptions {
  xrayService: XrayService;
  notificationCallback?: (notification: NotificationPayload) => Promise<void>;
}

export interface NotificationPayload {
  userId: Types.ObjectId;
  telegramId: string;
  type:
    | "trial_expires_2h"
    | "trial_expires_1h"
    | "trial_expired"
    | "trial_traffic_warning"
    | "trial_traffic_limit_reached"
    | "subscription_expires_3d"
    | "subscription_expires_1d"
    | "subscription_expired";
  firstName?: string;
  username?: string;
  expiresAt?: Date;
  daysLeft?: number;
  hoursLeft?: number;
  trafficUsedBytes?: number;
  trafficLimitBytes?: number;
  trafficUsedPercent?: number;
}

/**
 * Сервис для проверки истекших подписок и отправки напоминаний
 */
export class SubscriptionScheduler {
  private xrayService: XrayService;
  private notificationCallback?: (
    notification: NotificationPayload
  ) => Promise<void>;
  private intervalId?: NodeJS.Timeout;
  private trafficCheckIntervalId?: NodeJS.Timeout;

  constructor(options: SubscriptionSchedulerOptions) {
    this.xrayService = options.xrayService;
    this.notificationCallback = options.notificationCallback;
  }

  /**
   * Запуск планировщика (каждые 30 минут для проверки часовых триалов)
   */
  start(intervalMs: number = 30 * 60 * 1000): void {
    console.log("[SubscriptionScheduler] Starting scheduler...");

    // Запускаем сразу
    this.checkAndProcessExpiredSubscriptions().catch((err) => {
      console.error(
        "[SubscriptionScheduler] Initial check failed:",
        err
      );
    });

    // И затем по расписанию
    this.intervalId = setInterval(() => {
      this.checkAndProcessExpiredSubscriptions().catch((err) => {
        console.error("[SubscriptionScheduler] Scheduled check failed:", err);
      });
    }, intervalMs);

    // Запускаем проверку трафика каждые 5 минут
    const trafficCheckInterval = 5 * 60 * 1000; // 5 минут
    this.checkTrialTrafficLimits().catch((err) => {
      console.error(
        "[TrialTrafficChecker] Initial check failed:",
        err
      );
    });

    this.trafficCheckIntervalId = setInterval(() => {
      this.checkTrialTrafficLimits().catch((err) => {
        console.error("[TrialTrafficChecker] Scheduled check failed:", err);
      });
    }, trafficCheckInterval);

    console.log(
      `[SubscriptionScheduler] Scheduler started (interval: ${
        intervalMs / 1000
      }s)`
    );
    console.log(
      `[TrialTrafficChecker] Traffic checker started (interval: ${
        trafficCheckInterval / 1000
      }s)`
    );
  }

  /**
   * Остановка планировщика
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.log("[SubscriptionScheduler] Scheduler stopped");
    }
    if (this.trafficCheckIntervalId) {
      clearInterval(this.trafficCheckIntervalId);
      this.trafficCheckIntervalId = undefined;
      console.log("[TrialTrafficChecker] Traffic checker stopped");
    }
  }

  /**
   * Основная логика проверки и обработки истекших подписок
   */
  async checkAndProcessExpiredSubscriptions(): Promise<void> {
    const now = new Date();
    console.log(`[SubscriptionScheduler] Running check at ${now.toISOString()}`);

    try {
      // 1. Проверяем истекшие тестовые периоды
      await this.processExpiredTrials(now);

      // 2. Проверяем истекшие платные подписки
      await this.processExpiredSubscriptions(now);

      // 3. Проверяем лимиты трафика для триальных пользователей
      await this.checkTrialTrafficLimits();

      // 4. Отправляем напоминания для триала за 2 часа до истечения
      await this.sendTrialExpirationReminders(now, 2);

      // 5. Отправляем напоминания для триала за 1 час до истечения
      await this.sendTrialExpirationReminders(now, 1);

      // 6. Отправляем напоминания для подписок за 3 дня до истечения
      await this.sendExpirationReminders(now, 3);

      // 7. Отправляем напоминания для подписок за 1 день до истечения
      await this.sendExpirationReminders(now, 1);

      console.log("[SubscriptionScheduler] Check completed successfully");
    } catch (error) {
      console.error("[SubscriptionScheduler] Check failed:", error);
      throw error;
    }
  }

  /**
   * Обработка истекших тестовых периодов
   */
  private async processExpiredTrials(now: Date): Promise<void> {
    const expiredTrialUsers = await User.find({
      subscriptionStatus: "trial",
      trialEndsAt: { $lte: now },
    });

    console.log(
      `[SubscriptionScheduler] Found ${expiredTrialUsers.length} expired trial(s)`
    );

    for (const user of expiredTrialUsers) {
      try {
        // Меняем статус пользователя
        user.subscriptionStatus = "expired";
        await user.save();

        // Деактивируем все VLESS аккаунты пользователя
        const accounts = await VlessAccount.find({
          userId: user._id,
          isActive: true,
        });

        for (const account of accounts) {
          await this.xrayService.deleteUser(
            account._id.toString(),
            user.telegramId
          );
          console.log(
            `[SubscriptionScheduler] Deactivated VLESS account ${account.email}`
          );
        }

        // Обновляем статус подписки
        await Subscription.updateMany(
          { userId: user._id, type: "trial", status: "active" },
          { $set: { status: "expired" } }
        );

        // Отправляем уведомление об истечении
        await this.sendNotification({
          userId: user._id,
          telegramId: user.telegramId,
          type: "trial_expired",
          firstName: user.firstName || undefined,
          username: user.username || undefined,
          expiresAt: user.trialEndsAt!,
          hoursLeft: 0,
        });

        console.log(
          `[SubscriptionScheduler] Processed expired trial for user ${user.telegramId}`
        );
      } catch (error) {
        console.error(
          `[SubscriptionScheduler] Failed to process expired trial for user ${user.telegramId}:`,
          error
        );
      }
    }
  }

  /**
   * Обработка истекших платных подписок
   */
  private async processExpiredSubscriptions(now: Date): Promise<void> {
    const expiredSubUsers = await User.find({
      subscriptionStatus: "active",
      subscriptionEndsAt: { $lte: now },
    });

    console.log(
      `[SubscriptionScheduler] Found ${expiredSubUsers.length} expired subscription(s)`
    );

    for (const user of expiredSubUsers) {
      try {
        // Меняем статус пользователя
        user.subscriptionStatus = "expired";
        await user.save();

        // Деактивируем все VLESS аккаунты пользователя
        const accounts = await VlessAccount.find({
          userId: user._id,
          isActive: true,
        });

        for (const account of accounts) {
          await this.xrayService.deleteUser(
            account._id.toString(),
            user.telegramId
          );
          console.log(
            `[SubscriptionScheduler] Deactivated VLESS account ${account.email}`
          );
        }

        // Обновляем статус подписки
        await Subscription.updateMany(
          { userId: user._id, status: "active" },
          { $set: { status: "expired" } }
        );

        // Отправляем уведомление об истечении
        await this.sendNotification({
          userId: user._id,
          telegramId: user.telegramId,
          type: "subscription_expired",
          firstName: user.firstName || undefined,
          username: user.username || undefined,
          expiresAt: user.subscriptionEndsAt!,
          daysLeft: 0,
        });

        console.log(
          `[SubscriptionScheduler] Processed expired subscription for user ${user.telegramId}`
        );
      } catch (error) {
        console.error(
          `[SubscriptionScheduler] Failed to process expired subscription for user ${user.telegramId}:`,
          error
        );
      }
    }
  }

  /**
   * Проверка лимитов трафика для триальных пользователей
   */
  private async checkTrialTrafficLimits(): Promise<void> {
    const trialUsers = await User.find({
      subscriptionStatus: "trial",
    });

    console.log(
      `[TrialTrafficChecker] Checking ${trialUsers.length} trial user(s)...`
    );

    for (const user of trialUsers) {
      try {
        // Получаем все активные аккаунты пользователя
        const accounts = await VlessAccount.find({
          userId: user._id,
          isActive: true,
        });

        if (accounts.length === 0) {
          continue;
        }

        // Суммируем трафик всех аккаунтов
        let totalUplink = 0;
        let totalDownlink = 0;

        for (const account of accounts) {
          try {
            const stats = await this.xrayService.getTrafficByEmail(
              account.email,
              false
            );
            totalUplink += stats.uplink || 0;
            totalDownlink += stats.downlink || 0;
          } catch (error) {
            console.error(
              `[TrialTrafficChecker] Failed to get traffic for ${account.email}:`,
              error
            );
          }
        }

        const totalUsed = totalUplink + totalDownlink;
        const limit = user.trialTrafficLimitBytes || config.TRIAL_TRAFFIC_LIMIT_BYTES;
        const usedPercent = Math.round((totalUsed / limit) * 100);

        // Обновляем статистику использования в БД
        user.trialTrafficUsedBytes = totalUsed;
        user.trialTrafficLastSyncAt = new Date();
        await user.save();

        console.log(
          `[TrialTrafficChecker] User ${user.telegramId}: used ${(
            totalUsed /
            1024 /
            1024
          ).toFixed(2)}MB / ${(limit / 1024 / 1024).toFixed(
            0
          )}MB (${usedPercent}%)`
        );

        // Проверяем превышение лимита
        if (totalUsed >= limit) {
          console.log(
            `[TrialTrafficChecker] User ${user.telegramId}: LIMIT EXCEEDED! Deactivating...`
          );

          // Меняем статус пользователя
          user.subscriptionStatus = "expired";
          await user.save();

          // Деактивируем все VLESS аккаунты
          for (const account of accounts) {
            await this.xrayService.deleteUser(
              account._id.toString(),
              user.telegramId
            );
            console.log(
              `[TrialTrafficChecker] Deactivated account ${account.email}`
            );
          }

          // Обновляем статус подписки
          await Subscription.updateMany(
            { userId: user._id, type: "trial", status: "active" },
            { $set: { status: "expired" } }
          );

          // Отправляем уведомление о превышении лимита
          await this.sendNotification({
            userId: user._id,
            telegramId: user.telegramId,
            type: "trial_traffic_limit_reached",
            firstName: user.firstName || undefined,
            username: user.username || undefined,
            trafficUsedBytes: totalUsed,
            trafficLimitBytes: limit,
            trafficUsedPercent: usedPercent,
          });
        } else if (
          usedPercent >= config.TRIAL_TRAFFIC_WARNING_PERCENT &&
          usedPercent < 100
        ) {
          // Проверяем, не отправляли ли уже предупреждение
          const alreadySent = await NotificationLog.findOne({
            userId: user._id,
            type: "trial_traffic_warning",
            sentAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // За последний час
          });

          if (!alreadySent) {
            console.log(
              `[TrialTrafficChecker] User ${user.telegramId}: WARNING at ${usedPercent}%`
            );

            await this.sendNotification({
              userId: user._id,
              telegramId: user.telegramId,
              type: "trial_traffic_warning",
              firstName: user.firstName || undefined,
              username: user.username || undefined,
              trafficUsedBytes: totalUsed,
              trafficLimitBytes: limit,
              trafficUsedPercent: usedPercent,
            });
          }
        }
      } catch (error) {
        console.error(
          `[TrialTrafficChecker] Failed to check traffic for user ${user.telegramId}:`,
          error
        );
      }
    }

    console.log("[TrialTrafficChecker] Check completed");
  }

  /**
   * Отправка напоминаний о скором истечении триала (по часам)
   */
  private async sendTrialExpirationReminders(
    now: Date,
    hoursBeforeExpiry: number
  ): Promise<void> {
    const reminderDate = new Date(now);
    reminderDate.setHours(reminderDate.getHours() + hoursBeforeExpiry);

    // Напоминания для тестовых периодов (по часам)
    const trialUsersToNotify = await User.find({
      subscriptionStatus: "trial",
      trialEndsAt: {
        $gte: reminderDate,
        $lt: new Date(reminderDate.getTime() + 60 * 60 * 1000), // +1 час
      },
    });

    console.log(
      `[SubscriptionScheduler] Found ${trialUsersToNotify.length} trial user(s) expiring in ${hoursBeforeExpiry} hour(s)`
    );

    for (const user of trialUsersToNotify) {
      // Проверяем, не отправляли ли уже это напоминание
      const alreadySent = await NotificationLog.findOne({
        userId: user._id,
        type: `trial_expires_${hoursBeforeExpiry}h` as any,
        sentAt: { $gte: new Date(now.getTime() - 30 * 60 * 1000) }, // За последние 30 минут
      });

      if (!alreadySent) {
        await this.sendNotification({
          userId: user._id,
          telegramId: user.telegramId,
          type: `trial_expires_${hoursBeforeExpiry}h` as any,
          firstName: user.firstName || undefined,
          username: user.username || undefined,
          expiresAt: user.trialEndsAt!,
          hoursLeft: hoursBeforeExpiry,
        });
      }
    }
  }

  /**
   * Отправка напоминаний о скором истечении подписки (по дням)
   */
  private async sendExpirationReminders(
    now: Date,
    daysBeforeExpiry: number
  ): Promise<void> {
    const reminderDate = new Date(now);
    reminderDate.setDate(reminderDate.getDate() + daysBeforeExpiry);

    // Напоминания для платных подписок
    const subUsersToNotify = await User.find({
      subscriptionStatus: "active",
      subscriptionEndsAt: {
        $gte: reminderDate,
        $lt: new Date(reminderDate.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    console.log(
      `[SubscriptionScheduler] Found ${subUsersToNotify.length} subscription user(s) expiring in ${daysBeforeExpiry} day(s)`
    );

    for (const user of subUsersToNotify) {
      const alreadySent = await NotificationLog.findOne({
        userId: user._id,
        type: `subscription_expires_${daysBeforeExpiry}d` as any,
        sentAt: { $gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
      });

      if (!alreadySent) {
        await this.sendNotification({
          userId: user._id,
          telegramId: user.telegramId,
          type: `subscription_expires_${daysBeforeExpiry}d` as any,
          firstName: user.firstName || undefined,
          username: user.username || undefined,
          expiresAt: user.subscriptionEndsAt!,
          daysLeft: daysBeforeExpiry,
        });
      }
    }
  }

  /**
   * Отправка уведомления пользователю
   */
  private async sendNotification(
    notification: NotificationPayload
  ): Promise<void> {
    try {
      // Вызываем callback для отправки уведомления в Telegram
      if (this.notificationCallback) {
        await this.notificationCallback(notification);
      }

      // Логируем отправку
      await NotificationLog.create({
        userId: notification.userId,
        telegramId: notification.telegramId,
        type: notification.type,
        sentAt: new Date(),
        success: true,
        metadata: {
          expiresAt: notification.expiresAt,
          daysLeft: notification.daysLeft,
          hoursLeft: notification.hoursLeft,
        },
      });

      console.log(
        `[SubscriptionScheduler] Sent notification ${notification.type} to user ${notification.telegramId}`
      );
    } catch (error: any) {
      console.error(
        `[SubscriptionScheduler] Failed to send notification ${notification.type} to user ${notification.telegramId}:`,
        error
      );

      // Логируем ошибку
      await NotificationLog.create({
        userId: notification.userId,
        telegramId: notification.telegramId,
        type: notification.type,
        sentAt: new Date(),
        success: false,
        errorMessage: error.message,
        metadata: {
          expiresAt: notification.expiresAt,
          daysLeft: notification.daysLeft,
          hoursLeft: notification.hoursLeft,
        },
      }).catch(() => {
        // Игнорируем ошибки при логировании
      });
    }
  }

  /**
   * Ручной запуск проверки (для тестирования)
   */
  async runNow(): Promise<void> {
    await this.checkAndProcessExpiredSubscriptions();
  }
}

