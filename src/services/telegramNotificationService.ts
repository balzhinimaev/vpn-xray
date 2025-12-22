import { config } from "../config/index.js";

export interface TelegramNotificationPayload {
  userId: string;
  telegramId: string;
  type: string;
  firstName?: string;
  username?: string;
  expiresAt?: Date;
  daysLeft?: number;
  hoursLeft?: number;
  trafficUsedBytes?: number;
  trafficLimitBytes?: number;
  trafficUsedPercent?: number;
}

export class TelegramNotificationService {
  private botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  /**
   * Отправка уведомления пользователю в Telegram
   */
  async sendNotification(notification: TelegramNotificationPayload): Promise<boolean> {
    try {
      if (!this.botToken) {
        console.warn("⚠️ BOT_TOKEN не настроен, уведомление не отправлено");
        return false;
      }

      const message = this.formatMessage(notification);
      const chatId = notification.telegramId;

      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`❌ Ошибка отправки уведомления в Telegram:`, errorData);
        return false;
      }

      console.log(`✅ Уведомление отправлено пользователю ${notification.telegramId}`);
      return true;
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления:`, error);
      return false;
    }
  }

  /**
   * Отправка уведомления об успешной оплате
   */
  async sendPaymentSuccessNotification(
    telegramId: string,
    subscriptionType: string,
    expiresAt: Date,
    vlessLink?: string
  ): Promise<boolean> {
    try {
      if (!this.botToken) {
        console.warn("⚠️ BOT_TOKEN не настроен, уведомление не отправлено");
        return false;
      }

      const message = this.formatPaymentSuccessMessage(subscriptionType, expiresAt, vlessLink);

      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: telegramId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`❌ Ошибка отправки уведомления об оплате:`, errorData);
        return false;
      }

      console.log(`✅ Уведомление об оплате отправлено пользователю ${telegramId}`);
      return true;
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления об оплате:`, error);
      return false;
    }
  }

  /**
   * Форматирование размера трафика (MB или GB)
   */
  private formatTrafficSize(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    if (mb >= 1024) {
      const gb = (mb / 1024).toFixed(2);
      return `${gb} GB`;
    }
    return `${mb.toFixed(2)} MB`;
  }

  /**
   * Форматирование сообщения для уведомлений
   */
  private formatMessage(notification: TelegramNotificationPayload): string {
    const { type, firstName, username, expiresAt, daysLeft, hoursLeft, trafficUsedBytes, trafficLimitBytes, trafficUsedPercent } = notification;

    const name = firstName || username || "Пользователь";
    const timeLeft = hoursLeft ? `${hoursLeft} час(ов)` : daysLeft ? `${daysLeft} день(ей)` : "0";

    switch (type) {
      case "trial_welcome":
        const trialHours = hoursLeft || 24;
        const trialTraffic = trafficLimitBytes ? this.formatTrafficSize(trafficLimitBytes) : "1 GB";
        return `🎉 <b>Добро пожаловать, ${name}!</b>\n\n✅ Вам предоставлен пробный период:\n⏰ <b>${trialHours} часов</b>\n📊 <b>${trialTraffic} трафика</b>\n\nНаслаждайтесь VPN без ограничений!`;

      case "trial_expires_2h":
        return `⏰ <b>${name}</b>, ваш пробный период истекает через ${timeLeft}!\n\nПродлите подписку, чтобы продолжить пользоваться VPN без ограничений.`;

      case "trial_expires_1h":
        return `⚠️ <b>${name}</b>, ваш пробный период истекает через ${timeLeft}!\n\nСрочно продлите подписку, чтобы не потерять доступ к VPN.`;

      case "trial_expired":
        return `❌ <b>${name}</b>, ваш пробный период истек.\n\nПродлите подписку, чтобы восстановить доступ к VPN.`;

      case "trial_traffic_warning":
        const used = trafficUsedBytes ? this.formatTrafficSize(trafficUsedBytes) : "0 MB";
        const limit = trafficLimitBytes ? this.formatTrafficSize(trafficLimitBytes) : "0 MB";
        const remaining = trafficLimitBytes && trafficUsedBytes 
          ? this.formatTrafficSize(trafficLimitBytes - trafficUsedBytes) 
          : "0 MB";
        return `📊 <b>${name}</b>, вы использовали ${used} из ${limit} (${trafficUsedPercent}%)\n\nОсталось трафика: ${remaining}`;

      case "trial_traffic_limit_reached":
        return `🚫 <b>${name}</b>, вы исчерпали лимит трафика пробного периода.\n\nПродлите подписку для безлимитного доступа к VPN.`;

      case "subscription_expires_3d":
        return `⏰ <b>${name}</b>, ваша подписка истекает через ${timeLeft}.\n\nПродлите подписку, чтобы не потерять доступ к VPN.`;

      case "subscription_expires_1d":
        return `⚠️ <b>${name}</b>, ваша подписка истекает завтра!\n\nСрочно продлите подписку, чтобы не потерять доступ к VPN.`;

      case "subscription_expired":
        return `❌ <b>${name}</b>, ваша подписка истекла.\n\nПродлите подписку, чтобы восстановить доступ к VPN.`;

      case "subscription_renewed":
        return `✅ <b>${name}</b>, ваша подписка успешно продлена до ${expiresAt?.toLocaleDateString('ru-RU')}!\n\nСпасибо за использование нашего VPN сервиса!`;

      default:
        return `📢 <b>${name}</b>, уведомление от VPN сервиса.`;
    }
  }

  /**
   * Форматирование сообщения об успешной оплате
   */
  private formatPaymentSuccessMessage(subscriptionType: string, expiresAt: Date, vlessLink?: string): string {
    const typeNames = {
      weekly: "недельная",
      monthly: "месячная", 
      quarterly: "квартальная",
      yearly: "годовая"
    };

    const typeName = typeNames[subscriptionType as keyof typeof typeNames] || subscriptionType;
    const expiresAtFormatted = expiresAt.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let message = `🎉 <b>Оплата успешно обработана!</b>\n\n`;
    message += `✅ Активирована ${typeName} подписка\n`;
    message += `📅 Действует до: ${expiresAtFormatted}\n\n`;
    message += `🔐 Ваш VPN аккаунт активирован и готов к использованию!\n\n`;

    if (vlessLink) {
      message += `📱 <b>VLESS ссылка:</b>\n<code>${vlessLink}</code>\n\n`;
      message += `💡 Скопируйте ссылку и добавьте в ваш VPN клиент для подключения.`;
    } else {
      message += `💡 Ваша VLESS ссылка будет доступна в личном кабинете.`;
    }

    return message;
  }
}
