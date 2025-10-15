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
    | "subscription_expires_3d"
    | "subscription_expires_1d"
    | "subscription_expired";
  firstName?: string;
  username?: string;
  expiresAt: Date;
  daysLeft?: number;
  hoursLeft?: number;
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

    console.log(
      `[SubscriptionScheduler] Scheduler started (interval: ${
        intervalMs / 1000
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

      // 3. Отправляем напоминания для триала за 2 часа до истечения
      await this.sendTrialExpirationReminders(now, 2);

      // 4. Отправляем напоминания для триала за 1 час до истечения
      await this.sendTrialExpirationReminders(now, 1);

      // 5. Отправляем напоминания для подписок за 3 дня до истечения
      await this.sendExpirationReminders(now, 3);

      // 6. Отправляем напоминания для подписок за 1 день до истечения
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

