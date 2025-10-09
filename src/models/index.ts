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
    lastSeenAt: { type: Date, default: Date.now },
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

  const update: Partial<UserSchemaType> = {
    telegramId,
    username: payload.username ?? undefined,
    firstName: payload.first_name ?? undefined,
    lastName: payload.last_name ?? undefined,
    languageCode: payload.language_code ?? undefined,
    isPremium: payload.is_premium ?? false,
    lastSeenAt: now,
  };

  return User.findOneAndUpdate({ telegramId }, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  }).exec();
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
