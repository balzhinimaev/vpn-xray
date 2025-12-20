import mongoose from "mongoose";
import { config } from "./config/index.js";
import { pickVlessInbound } from "./xray/inbound.js";
import { XrayService } from "./services/xrayService.js";
import { SubscriptionScheduler } from "./services/subscriptionScheduler.js";
import { JWTService } from "./auth/jwtService.js";
import { createApp } from "./app.js";
import { firstExternalIPv4 } from "./utils/network.js";

async function connectMongoDB() {
  try {
    await mongoose.connect(config.MONGO_URI, {
      dbName: "xray-provisioner",
    });
    console.log("[BOOT] MongoDB connected:", config.MONGO_URI);

    mongoose.connection.on("error", (err) => {
      console.error("[MongoDB] Connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("[MongoDB] Disconnected");
    });
  } catch (error) {
    console.error("[BOOT] Failed to connect to MongoDB:", error);
    throw error;
  }
}

async function bootstrap() {
  // 1. Подключаемся к MongoDB
  await connectMongoDB();

  // 2. Валидация конфигурации
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 32) {
    throw new Error(
      "JWT_SECRET is not set or too short (min 32 characters). Check .env file."
    );
  }

  if (!config.BOT_TOKEN) {
    console.warn(
      "[BOOT] WARNING: BOT_TOKEN is not set. Telegram auth will not work!"
    );
  }

  // 3. Инициализация JWT сервиса
  const jwtService = new JWTService({
    secret: config.JWT_SECRET,
    accessExpiry: config.JWT_ACCESS_EXPIRY,
    refreshExpiry: config.JWT_REFRESH_EXPIRY,
  });

  // 4. Выбираем inbound
  const inbound = pickVlessInbound(config.INBOUND_TAG);
  const publicHost = config.PUBLIC_HOST || firstExternalIPv4() || "";

  if (!publicHost) {
    console.error(
      "[BOOT] X_PUBLIC_HOST is not set and no external IPv4 found. Set X_PUBLIC_HOST."
    );
  }

  console.log("[BOOT] Selected inbound:", {
    tag: inbound.tag,
    port: inbound.port,
    security: inbound.security,
    network: inbound.network,
    sni: inbound.sni,
    pbk: inbound.pbk ? "(found)" : "(none)",
    path: inbound.path,
  });

  // 5. Инициализация XrayService
  const service = await XrayService.create({
    inbound,
    publicHost,
    defaultFlow: config.DEFAULT_FLOW,
    grpcHost: config.GRPC_HOST,
    grpcPort: config.GRPC_PORT,
    protoFiles: config.PROTO_FILES,
    maxAccountsPerUser: config.MAX_ACCOUNTS_PER_USER,
    defaultExpiryDays: config.DEFAULT_ACCOUNT_EXPIRY_DAYS,
  });

  // 6. Инициализация сервиса уведомлений
  const { TelegramNotificationService } = await import("./services/telegramNotificationService.js");
  const notificationService = new TelegramNotificationService(config.BOT_TOKEN);

  // 7. Инициализация планировщика подписок
  const scheduler = new SubscriptionScheduler({
    xrayService: service,
    notificationCallback: async (notification) => {
      // Отправляем уведомления через Telegram Bot API
      try {
        await notificationService.sendNotification({
          userId: notification.userId.toString(),
          telegramId: notification.telegramId,
          type: notification.type,
          firstName: notification.firstName,
          username: notification.username,
          expiresAt: notification.expiresAt,
          daysLeft: notification.daysLeft,
          hoursLeft: notification.hoursLeft,
          trafficUsedBytes: notification.trafficUsedBytes,
          trafficLimitBytes: notification.trafficLimitBytes,
          trafficUsedPercent: notification.trafficUsedPercent,
        });
      } catch (error) {
        console.error(`[SubscriptionScheduler] Ошибка отправки уведомления:`, error);
      }
    },
  });

  // Запускаем планировщик (проверка каждые 30 минут для часовых триалов)
  scheduler.start(30 * 60 * 1000);

  // 8. Создаём Express app
  const app = createApp({
    service,
    jwtService,
    botToken: config.BOT_TOKEN,
    botRegistrationSecret: config.BOT_REGISTRATION_SECRET,
    apiToken: config.API_TOKEN,
    corsOrigin: config.CORS_ORIGIN,
  });

  // 9. Запускаем сервер
  app.listen(config.HTTP_PORT, config.HTTP_HOST, () => {
    console.log(
      `[BOOT] 🚀 Server listening on http://${config.HTTP_HOST}:${config.HTTP_PORT}`
    );
    console.log(
      `[BOOT] gRPC target: ${config.GRPC_ADDR} — mode: ${
        service.mode === "sdk" ? "SDK" : "Proto"
      }`
    );
    console.log(
      `[BOOT] JWT Auth: ${config.JWT_SECRET ? "✅ ENABLED" : "❌ DISABLED"}`
    );
    console.log(
      `[BOOT] Legacy API Token: ${
        config.API_TOKEN ? "✅ ENABLED" : "❌ DISABLED"
      }`
    );
    console.log(
      `[BOOT] Max accounts per user: ${config.MAX_ACCOUNTS_PER_USER}`
    );
    console.log(
      `[BOOT] Default account expiry: ${config.DEFAULT_ACCOUNT_EXPIRY_DAYS} days`
    );

    if (config.TELEGRAM_MINI_APP_URL) {
      console.log(
        `[BOOT] Telegram Mini App URL: ${config.TELEGRAM_MINI_APP_URL}`
      );
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("[BOOT] SIGTERM received, closing connections...");
    scheduler.stop();
    await mongoose.connection.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("[BOOT] SIGINT received, closing connections...");
    scheduler.stop();
    await mongoose.connection.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error("[BOOT] Failed to start application:", err);
  process.exitCode = 1;
});
