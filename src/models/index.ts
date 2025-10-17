import mongoose, {
  HydratedDocument,
  InferSchemaType,
  Model,
  Schema,
  Types,
} from "mongoose";

const userSchema = new Schema(
  {
    telegramId: { type: String, required: true, unique: true },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    languageCode: { type: String },
    isPremium: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    telegram_min_app_opened: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: Date.now },
    // Subscription management
    subscriptionStatus: {
      type: String,
      enum: ["trial", "active", "expired", "cancelled"],
      default: "trial",
    },
    trialEndsAt: { type: Date }, // Дата окончания тестового периода
    subscriptionEndsAt: { type: Date }, // Дата окончания оплаченной подписки
    lastNotificationSentAt: { type: Date }, // Последнее отправленное напоминание
    // Trial traffic limits
    trialTrafficLimitBytes: { type: Number, default: 104857600 }, // 100 MB по умолчанию
    trialTrafficUsedBytes: { type: Number, default: 0 }, // Использовано байт
    trialTrafficLastSyncAt: { type: Date }, // Последняя синхронизация трафика
    // Referral system
    referralCode: { type: String, unique: true, sparse: true }, // Уникальный реферальный код пользователя
    referredBy: { type: String }, // telegramId реферера
    referralCount: { type: Number, default: 0 }, // Количество приглашенных пользователей
    referralBonusTrafficBytes: { type: Number, default: 0 }, // Бонусный трафик от рефералов
    referralBonusDays: { type: Number, default: 0 }, // Бонусные дни подписки от рефералов
  },
  { timestamps: true }
);

export type UserSchemaType = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserSchemaType>;
export const User: Model<UserSchemaType> =
  mongoose.models.User ?? mongoose.model<UserSchemaType>("User", userSchema);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String, required: true },
    refreshToken: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    deviceInfo: { type: String },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionSchemaType = InferSchemaType<typeof sessionSchema>;
export type SessionDocument = HydratedDocument<SessionSchemaType>;
export const Session: Model<SessionSchemaType> =
  mongoose.models.Session ??
  mongoose.model<SessionSchemaType>("Session", sessionSchema);

const vlessAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    uuid: { type: String, required: true },
    flow: { type: String },
    remark: { type: String },
    inboundTag: { type: String, required: true },
    port: { type: Number, required: true },
    security: { type: String, required: true },
    link: { type: String, required: true },
    rawConfig: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

export type VlessAccountSchemaType = InferSchemaType<typeof vlessAccountSchema>;
export type VlessAccountDocument = HydratedDocument<VlessAccountSchemaType>;
export const VlessAccount: Model<VlessAccountSchemaType> =
  mongoose.models.VlessAccount ??
  mongoose.model<VlessAccountSchemaType>("VlessAccount", vlessAccountSchema);

const trafficHistorySchema = new Schema(
  {
    date: { type: Date, required: true },
    uplink: { type: Number, required: true },
    downlink: { type: Number, required: true },
  },
  { _id: false }
);

const trafficSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: "VlessAccount", required: true },
    email: { type: String, required: true },
    uplink: { type: Number, default: 0 },
    downlink: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    lastReset: { type: Date },
    lastSyncedAt: { type: Date, default: Date.now },
    history: { type: [trafficHistorySchema], default: [] },
  },
  { timestamps: true }
);

trafficSchema.index({ accountId: 1 }, { unique: true });
trafficSchema.index({ email: 1 });

export type TrafficSchemaType = InferSchemaType<typeof trafficSchema>;
export type TrafficDocument = HydratedDocument<TrafficSchemaType>;
export const Traffic: Model<TrafficSchemaType> =
  mongoose.models.Traffic ??
  mongoose.model<TrafficSchemaType>("Traffic", trafficSchema);

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String, required: true },
    type: {
      type: String,
      enum: ["trial", "monthly", "quarterly", "yearly"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "refunded"],
      default: "active",
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    price: { type: Number, default: 0 }, // Цена в копейках/центах
    currency: { type: String, default: "RUB" },
    paymentProvider: { type: String }, // Telegram Stars, YooKassa, etc.
    paymentId: { type: String }, // ID транзакции от провайдера
    autoRenew: { type: Boolean, default: false },
    cancelledAt: { type: Date },
    cancelReason: { type: String },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ endsAt: 1 });

export type SubscriptionSchemaType = InferSchemaType<typeof subscriptionSchema>;
export type SubscriptionDocument = HydratedDocument<SubscriptionSchemaType>;
export const Subscription: Model<SubscriptionSchemaType> =
  mongoose.models.Subscription ??
  mongoose.model<SubscriptionSchemaType>("Subscription", subscriptionSchema);

const notificationLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    telegramId: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "trial_welcome",
        "trial_expires_3d",
        "trial_expires_1d",
        "trial_expired",
        "trial_traffic_warning",
        "trial_traffic_limit_reached",
        "subscription_expires_3d",
        "subscription_expires_1d",
        "subscription_expired",
        "subscription_renewed",
      ],
      required: true,
    },
    sentAt: { type: Date, default: Date.now },
    success: { type: Boolean, default: true },
    errorMessage: { type: String },
    metadata: { type: Schema.Types.Mixed }, // Дополнительные данные (текст, кнопки и т.д.)
  },
  { timestamps: true }
);

notificationLogSchema.index({ userId: 1, type: 1, sentAt: -1 });
notificationLogSchema.index({ telegramId: 1, sentAt: -1 });

export type NotificationLogSchemaType = InferSchemaType<
  typeof notificationLogSchema
>;
export type NotificationLogDocument = HydratedDocument<NotificationLogSchemaType>;
export const NotificationLog: Model<NotificationLogSchemaType> =
  mongoose.models.NotificationLog ??
  mongoose.model<NotificationLogSchemaType>(
    "NotificationLog",
    notificationLogSchema
  );

const referralSchema = new Schema(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Кто пригласил
    referrerTelegramId: { type: String, required: true },
    referredId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Кого пригласили
    referredTelegramId: { type: String, required: true },
    referralCode: { type: String, required: true }, // Какой реферальный код использовался
    bonusGranted: { type: Boolean, default: false }, // Был ли начислен бонус рефереру
    bonusType: { type: String, enum: ["traffic", "days", "both"], default: "traffic" },
    bonusTrafficMB: { type: Number, default: 0 }, // Сколько MB трафика начислено
    bonusDays: { type: Number, default: 0 }, // Сколько дней подписки начислено
    bonusGrantedAt: { type: Date }, // Когда был начислен бонус
    isActive: { type: Boolean, default: true }, // Активен ли реферал (если реферал заблокирован, можно отозвать бонус)
  },
  { timestamps: true }
);

referralSchema.index({ referrerId: 1, createdAt: -1 });
referralSchema.index({ referredId: 1 });
referralSchema.index({ referrerTelegramId: 1 });
referralSchema.index({ referredTelegramId: 1 }, { unique: true });

export type ReferralSchemaType = InferSchemaType<typeof referralSchema>;
export type ReferralDocument = HydratedDocument<ReferralSchemaType>;
export const Referral: Model<ReferralSchemaType> =
  mongoose.models.Referral ??
  mongoose.model<ReferralSchemaType>("Referral", referralSchema);

export interface TelegramUserPayload {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
}

function normalizeTelegramId(id: number | string): string {
  return typeof id === "number" ? id.toString() : id;
}

export async function findOrCreateUser(
  payload: TelegramUserPayload
): Promise<UserDocument> {
  const telegramId = normalizeTelegramId(payload.id);
  const now = new Date();

  console.log("[findOrCreateUser] Input payload:", payload);
  console.log("[findOrCreateUser] Normalized telegramId:", telegramId);

  const update: Partial<UserSchemaType> = {
    telegramId,
    username: payload.username ?? undefined,
    firstName: payload.first_name ?? undefined,
    lastName: payload.last_name ?? undefined,
    languageCode: payload.language_code ?? undefined,
    isPremium: payload.is_premium ?? false,
    lastSeenAt: now,
  };

  console.log("[findOrCreateUser] Update object:", update);

  const result = await User.findOneAndUpdate({ telegramId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  }).exec();

  console.log("[findOrCreateUser] Result:", {
    id: result._id,
    telegramId: result.telegramId,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt
  });

  return result;
}

export async function getUserAccountsCount(
  userId: Types.ObjectId | string
): Promise<number> {
  const id =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;

  return VlessAccount.countDocuments({ userId: id, isActive: true }).exec();
}

export async function saveTrafficSnapshot(
  accountId: Types.ObjectId | string,
  email: string,
  uplink: number,
  downlink: number
): Promise<void> {
  const id =
    typeof accountId === "string" ? new Types.ObjectId(accountId) : accountId;
  const now = new Date();
  const total = uplink + downlink;

  await Traffic.findOneAndUpdate(
    { accountId: id },
    {
      $set: {
        email,
        uplink,
        downlink,
        total,
        lastSyncedAt: now,
      },
      $setOnInsert: {
        lastReset: now,
      },
      $push: {
        history: {
          $each: [
            {
              date: now,
              uplink,
              downlink,
            },
          ],
          $slice: -90,
        },
      },
    },
    { upsert: true, new: false }
  ).exec();
}

/**
 * Генерирует уникальный реферальный код для пользователя
 * Формат: ref_<telegramId> (простой и предсказуемый)
 */
export function generateReferralCode(telegramId: string): string {
  return `ref_${telegramId}`;
}

/**
 * Извлекает telegramId из реферального кода
 */
export function extractTelegramIdFromReferralCode(referralCode: string): string | null {
  const match = referralCode.match(/^ref_(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Создает реферальную связь между пользователями и начисляет бонусы
 */
export async function createReferral(
  referredTelegramId: string,
  referralCode: string,
  config: {
    bonusTrafficMB: number;
    bonusDays: number;
    bonusType: "traffic" | "days" | "both";
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Извлекаем telegramId реферера из кода
    const referrerTelegramId = extractTelegramIdFromReferralCode(referralCode);
    if (!referrerTelegramId) {
      return { success: false, error: "Invalid referral code format" };
    }

    // Проверяем, что пользователь не приглашает сам себя
    if (referrerTelegramId === referredTelegramId) {
      return { success: false, error: "Cannot use your own referral code" };
    }

    // Проверяем, что реферер существует
    const referrer = await User.findOne({ telegramId: referrerTelegramId });
    if (!referrer) {
      return { success: false, error: "Referrer not found" };
    }

    // Проверяем, что приглашенный пользователь существует
    const referred = await User.findOne({ telegramId: referredTelegramId });
    if (!referred) {
      return { success: false, error: "Referred user not found" };
    }

    // Проверяем, что приглашенный пользователь еще не использовал реферальную ссылку
    if (referred.referredBy) {
      return { success: false, error: "User already used a referral code" };
    }

    // Проверяем, не существует ли уже такая реферальная связь
    const existingReferral = await Referral.findOne({
      referredTelegramId: referredTelegramId,
    });
    if (existingReferral) {
      return { success: false, error: "Referral already exists" };
    }

    // Начисляем бонусы рефереру
    const bonusTrafficBytes = config.bonusTrafficMB * 1024 * 1024;
    
    if (config.bonusType === "traffic" || config.bonusType === "both") {
      referrer.referralBonusTrafficBytes = (referrer.referralBonusTrafficBytes || 0) + bonusTrafficBytes;
      referrer.trialTrafficLimitBytes = (referrer.trialTrafficLimitBytes || 0) + bonusTrafficBytes;
    }
    
    if (config.bonusType === "days" || config.bonusType === "both") {
      referrer.referralBonusDays = (referrer.referralBonusDays || 0) + config.bonusDays;
      // Продлеваем подписку
      if (referrer.subscriptionStatus === "trial" && referrer.trialEndsAt) {
        referrer.trialEndsAt = new Date(referrer.trialEndsAt.getTime() + config.bonusDays * 24 * 60 * 60 * 1000);
      } else if (referrer.subscriptionStatus === "active" && referrer.subscriptionEndsAt) {
        referrer.subscriptionEndsAt = new Date(referrer.subscriptionEndsAt.getTime() + config.bonusDays * 24 * 60 * 60 * 1000);
      }
    }
    
    referrer.referralCount = (referrer.referralCount || 0) + 1;
    await referrer.save();

    // Обновляем приглашенного пользователя
    referred.referredBy = referrerTelegramId;
    await referred.save();

    // Создаем запись о реферале
    await Referral.create({
      referrerId: referrer._id,
      referrerTelegramId: referrer.telegramId,
      referredId: referred._id,
      referredTelegramId: referred.telegramId,
      referralCode,
      bonusGranted: true,
      bonusType: config.bonusType,
      bonusTrafficMB: config.bonusTrafficMB,
      bonusDays: config.bonusDays,
      bonusGrantedAt: new Date(),
      isActive: true,
    });

    console.log(`[createReferral] Successfully created referral: ${referrerTelegramId} -> ${referredTelegramId}`);
    console.log(`[createReferral] Bonus granted: ${config.bonusType}, traffic: ${config.bonusTrafficMB}MB, days: ${config.bonusDays}`);

    return { success: true };
  } catch (error: any) {
    console.error("[createReferral] Error:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}
