import { AddressInfo } from "node:net";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createApp } from "../../../app.js";
import { JWTService } from "../../../auth/jwtService.js";
import {
  User,
  Payment,
  Subscription,
  VlessAccount,
  Referral,
} from "../../../models/index.js";

const jwtService = new JWTService({
  secret: "test-secret-should-be-at-least-32-chars-long!!",
  accessExpiry: "1h",
  refreshExpiry: "7d",
});

const BOT_SECRET = "bot-secret";

let mongoServer: MongoMemoryReplSet;

// Mock xrayService
function createXrayServiceMock() {
  return {
    getInboundInfo() {
      return {
        tag: "vless-inbound",
        port: 443,
        security: "tls",
        network: "tcp",
        sni: "vpn.example.com",
      };
    },
    getPublicHost() {
      return "vpn.example.com";
    },
    async createUser(input: any, options?: any) {
      const uuid = "test-uuid-" + Date.now();
      const email = `user_${input.telegramId}@vpn.example.com`;
      
      // Create VlessAccount in DB
      const account = await VlessAccount.create([{
        userId: input.userId,
        telegramId: input.telegramId,
        email,
        uuid,
        flow: input.flow || "xtls-rprx-vision",
        remark: input.remark,
        inboundTag: "vless-inbound",
        port: 443,
        security: "tls",
        link: `vless://${uuid}@vpn.example.com:443?security=tls&type=tcp&flow=xtls-rprx-vision#${input.remark}`,
        isActive: true,
        expiresAt: options?.expiresAt,
      }], { session: options?.session });

      return {
        id: account[0]._id.toString(),
        uuid,
        email,
        link: account[0].link,
      };
    },
    async addUser() {
      return { ok: true };
    },
    client: {
      async addUser() {
        return { ok: true };
      },
    },
  } as any;
}

function buildApp(xrayService = createXrayServiceMock()) {
  return createApp({
    service: xrayService,
    jwtService,
    apiToken: "",
    botRegistrationSecret: BOT_SECRET,
  });
}

async function withServer(
  app: ReturnType<typeof buildApp>,
  cb: (baseUrl: string) => Promise<void>
) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await cb(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makePaymentRequest(overrides: Partial<{
  telegramId: string;
  paymentId: string;
  providerPaymentId: string;
  totalAmount: number;
  currency: string;
  period: string;
  invoicePayload: string;
}> = {}) {
  return {
    telegramId: "123456789",
    paymentId: "tg_pay_" + Date.now(),
    totalAmount: 99,
    currency: "XTR",
    period: "month",
    invoicePayload: JSON.stringify({ period: "month" }),
    ...overrides,
  };
}

beforeAll(async () => {
  // Use replica set to support transactions
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 120000); // 120 second timeout for MongoDB binary download and replica set init

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  // Clear all collections before each test
  await Promise.all([
    User.deleteMany({}),
    Payment.deleteMany({}),
    Subscription.deleteMany({}),
    VlessAccount.deleteMany({}),
    Referral.deleteMany({}),
  ]);
});

describe("POST /bot/payments/stars", () => {
  describe("Authentication", () => {
    test("rejects missing bot secret with 401", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makePaymentRequest()),
        });

        expect(response.status).toBe(401);
      });
    });

    test("rejects invalid bot secret with 401", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": "wrong-secret",
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        expect(response.status).toBe(401);
      });
    });
  });

  describe("Input validation", () => {
    test("rejects invalid telegramId", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ telegramId: "abc" })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.code).toBe("INTERNAL_ERROR");
      });
    });

    test("rejects missing paymentId", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const req = makePaymentRequest();
        delete (req as any).paymentId;

        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(req),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
      });
    });

    test("rejects invalid currency (not XTR)", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ currency: "USD" })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("XTR");
      });
    });

    test("rejects invalid period", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ period: "yearly" })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
      });
    });

    test("rejects invalid invoicePayload (not JSON)", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ invoicePayload: "not-json" })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("invoicePayload");
      });
    });
  });

  describe("Amount validation per plan", () => {
    test("rejects incorrect amount for 2weeks plan (expected 49)", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "2weeks",
            totalAmount: 50,
            invoicePayload: JSON.stringify({ period: "2weeks" }),
          })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.code).toBe("INVALID_AMOUNT");
        expect(body.error).toContain("49");
      });
    });

    test("rejects incorrect amount for month plan (expected 99)", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "month",
            totalAmount: 100,
            invoicePayload: JSON.stringify({ period: "month" }),
          })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.code).toBe("INVALID_AMOUNT");
      });
    });

    test("rejects incorrect amount for 3months plan (expected 249)", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "3months",
            totalAmount: 250,
            invoicePayload: JSON.stringify({ period: "3months" }),
          })),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.code).toBe("INVALID_AMOUNT");
      });
    });
  });

  describe("User validation", () => {
    test("returns USER_NOT_FOUND for non-existent user", async () => {
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.code).toBe("USER_NOT_FOUND");
      });
    });
  });

  describe("Successful payment processing", () => {
    test("processes 2weeks plan successfully (49 stars, 14 days)", async () => {
      // Create user first
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "2weeks",
            totalAmount: 49,
            invoicePayload: JSON.stringify({ period: "2weeks" }),
          })),
        });

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body.success).toBe(true);
        expect(body.payment).toBeDefined();
        expect(body.payment.amount).toBe(49);
        expect(body.payment.status).toBe("completed");

        expect(body.subscription).toBeDefined();
        expect(body.subscription.type).toBe("biweekly");
        expect(body.subscription.status).toBe("active");
        expect(body.subscription.daysAdded).toBe(14);

        expect(body.vpnAccount).toBeDefined();
        expect(body.vpnAccount.isActive).toBe(true);
        expect(body.vpnAccount.uuid).toBeDefined();
        expect(body.vpnAccount.link).toContain("vless://");
      });
    });

    test("processes month plan successfully (99 stars, 30 days)", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "month",
            totalAmount: 99,
            invoicePayload: JSON.stringify({ period: "month" }),
          })),
        });

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body.success).toBe(true);
        expect(body.payment.amount).toBe(99);
        expect(body.subscription.type).toBe("monthly");
        expect(body.subscription.daysAdded).toBe(30);
      });
    });

    test("processes 3months plan successfully (249 stars, 90 days)", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            period: "3months",
            totalAmount: 249,
            invoicePayload: JSON.stringify({ period: "3months" }),
          })),
        });

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body.success).toBe(true);
        expect(body.payment.amount).toBe(249);
        expect(body.subscription.type).toBe("quarterly");
        expect(body.subscription.daysAdded).toBe(90);
      });
    });

    test("creates payment record in database", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const paymentId = "tg_pay_test_" + Date.now();
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId })),
        });
      });

      const payment = await Payment.findOne({ telegramPaymentId: paymentId });
      expect(payment).toBeDefined();
      expect(payment!.amount).toBe(99);
      expect(payment!.currency).toBe("XTR");
      expect(payment!.type).toBe("telegram_stars");
      expect(payment!.status).toBe("completed");
      expect(payment!.period).toBe("month");
    });

    test("updates user subscription status to active", async () => {
      const user = await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });
      });

      const updatedUser = await User.findById(user._id);
      expect(updatedUser!.subscriptionStatus).toBe("active");
      expect(updatedUser!.subscriptionEndsAt).toBeDefined();
    });
  });

  describe("Idempotency", () => {
    test("returns same response for duplicate paymentId", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const paymentId = "tg_pay_duplicate_" + Date.now();
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        // First request
        const response1 = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId })),
        });

        const body1 = await response1.json();
        expect(body1.success).toBe(true);

        // Second request with same paymentId
        const response2 = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId })),
        });

        const body2 = await response2.json();
        expect(body2.success).toBe(true);
        expect(body2.payment.id).toBe(body1.payment.id);
        expect(body2.payment.telegramPaymentId).toBe(body1.payment.telegramPaymentId);
      });
    });

    test("does not create duplicate payment records", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const paymentId = "tg_pay_no_dupe_" + Date.now();
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        // Make two requests with the same paymentId
        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId })),
        });

        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId })),
        });
      });

      const payments = await Payment.find({ telegramPaymentId: paymentId });
      expect(payments.length).toBe(1);
    });
  });

  describe("Subscription extension", () => {
    test("extends existing active subscription", async () => {
      const now = new Date();
      const existingEndsAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now

      const user = await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "active",
        subscriptionEndsAt: existingEndsAt,
      });

      await Subscription.create({
        userId: user._id,
        telegramId: "123456789",
        type: "monthly",
        status: "active",
        startsAt: now,
        endsAt: existingEndsAt,
        price: 99,
        currency: "XTR",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();
        expect(body.success).toBe(true);

        // Subscription should be extended by 30 days from the existing end date
        const newExpiresAt = new Date(body.subscription.expiresAt);
        const expectedExpiresAt = new Date(existingEndsAt.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Compare dates (within 1 second tolerance for processing time)
        expect(Math.abs(newExpiresAt.getTime() - expectedExpiresAt.getTime())).toBeLessThan(1000);
      });
    });
  });

  describe("VPN Account management", () => {
    test("creates new VPN account if none exists", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.vpnAccount).toBeDefined();
        expect(body.vpnAccount.uuid).toBeDefined();
        expect(body.vpnAccount.email).toContain("123456789");
        expect(body.vpnAccount.link).toContain("vless://");
        expect(body.vpnAccount.isActive).toBe(true);
      });
    });

    test("reactivates inactive VPN account", async () => {
      const user = await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "expired",
      });

      // Create inactive VPN account
      await VlessAccount.create({
        userId: user._id,
        telegramId: "123456789",
        email: "user_123456789@vpn.example.com",
        uuid: "existing-uuid",
        flow: "xtls-rprx-vision",
        remark: "@testuser",
        inboundTag: "vless-inbound",
        port: 443,
        security: "tls",
        link: "vless://existing-uuid@vpn.example.com:443",
        isActive: false,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // expired yesterday
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.vpnAccount).toBeDefined();
        expect(body.vpnAccount.isActive).toBe(true);
      });

      // Verify in database
      const account = await VlessAccount.findOne({ telegramId: "123456789" });
      expect(account!.isActive).toBe(true);
    });

    test("updates existing active VPN account expiration", async () => {
      const user = await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "active",
      });

      const existingExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
      await VlessAccount.create({
        userId: user._id,
        telegramId: "123456789",
        email: "user_123456789@vpn.example.com",
        uuid: "existing-uuid",
        flow: "xtls-rprx-vision",
        remark: "@testuser",
        inboundTag: "vless-inbound",
        port: 443,
        security: "tls",
        link: "vless://existing-uuid@vpn.example.com:443",
        isActive: true,
        expiresAt: existingExpiry,
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();
        expect(body.success).toBe(true);

        // VPN expiry should be extended
        const newExpiresAt = new Date(body.vpnAccount.expiresAt);
        expect(newExpiresAt.getTime()).toBeGreaterThan(existingExpiry.getTime());
      });
    });
  });

  describe("Referral bonus", () => {
    test("grants referral bonus to referrer on first payment", async () => {
      // Create referrer
      const referrer = await User.create({
        telegramId: "111111111",
        username: "referrer",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
        referralCode: "ref_111111111",
      });

      // Create referred user with referredBy
      const referred = await User.create({
        telegramId: "123456789",
        username: "referred",
        subscriptionStatus: "trial",
        referredBy: "111111111",
      });

      // Create referral record (bonus not yet granted)
      await Referral.create({
        referrerId: referrer._id,
        referrerTelegramId: "111111111",
        referredId: referred._id,
        referredTelegramId: "123456789",
        referralCode: "ref_111111111",
        bonusGranted: false,
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();
        expect(body.success).toBe(true);
      });

      // Check that referrer's subscription was extended
      const updatedReferrer = await User.findById(referrer._id);
      expect(updatedReferrer!.referralBonusDays).toBeGreaterThan(0);

      // Check that referral record was updated
      const referralRecord = await Referral.findOne({ referredTelegramId: "123456789" });
      expect(referralRecord!.bonusGranted).toBe(true);
      expect(referralRecord!.bonusGrantedAt).toBeDefined();
    });

    test("does not grant referral bonus on second payment", async () => {
      // Create referrer
      const referrer = await User.create({
        telegramId: "111111111",
        username: "referrer",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        referralCode: "ref_111111111",
        referralBonusDays: 1, // Already got bonus
      });

      // Create referred user
      const referred = await User.create({
        telegramId: "123456789",
        username: "referred",
        subscriptionStatus: "active",
        referredBy: "111111111",
      });

      // Create existing payment (first payment already processed)
      await Payment.create({
        id: "first-payment",
        userId: referred._id,
        telegramId: "123456789",
        telegramPaymentId: "tg_first_payment",
        amount: 99,
        currency: "XTR",
        type: "telegram_stars",
        status: "completed",
        period: "month",
      });

      // Referral bonus already granted
      await Referral.create({
        referrerId: referrer._id,
        referrerTelegramId: "111111111",
        referredId: referred._id,
        referredTelegramId: "123456789",
        referralCode: "ref_111111111",
        bonusGranted: true,
        bonusGrantedAt: new Date(),
        bonusDays: 1,
      });

      const initialBonusDays = referrer.referralBonusDays;
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({ paymentId: "tg_second_payment" })),
        });
      });

      // Referrer's bonus days should not increase
      const updatedReferrer = await User.findById(referrer._id);
      expect(updatedReferrer!.referralBonusDays).toBe(initialBonusDays);
    });
  });

  describe("Response format", () => {
    test("returns correct response structure on success", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest()),
        });

        const body = await response.json();

        // Verify response structure
        expect(body).toMatchObject({
          success: true,
          payment: {
            id: expect.any(String),
            telegramPaymentId: expect.any(String),
            amount: expect.any(Number),
            status: "completed",
            createdAt: expect.any(String),
          },
          subscription: {
            id: expect.any(String),
            type: expect.any(String),
            status: "active",
            startsAt: expect.any(String),
            expiresAt: expect.any(String),
            daysAdded: expect.any(Number),
          },
          vpnAccount: {
            id: expect.any(String),
            uuid: expect.any(String),
            email: expect.any(String),
            link: expect.any(String),
            isActive: true,
            expiresAt: expect.any(String),
          },
        });

        // Verify dates are ISO format
        expect(() => new Date(body.payment.createdAt)).not.toThrow();
        expect(() => new Date(body.subscription.startsAt)).not.toThrow();
        expect(() => new Date(body.subscription.expiresAt)).not.toThrow();
        expect(() => new Date(body.vpnAccount.expiresAt)).not.toThrow();
      });
    });
  });

  describe("Provider payment ID", () => {
    test("stores providerPaymentId when provided", async () => {
      await User.create({
        telegramId: "123456789",
        username: "testuser",
        subscriptionStatus: "trial",
      });

      const paymentId = "tg_pay_provider_" + Date.now();
      const providerPaymentId = "provider_charge_abc123";
      const app = buildApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/bot/payments/stars`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bot-secret": BOT_SECRET,
          },
          body: JSON.stringify(makePaymentRequest({
            paymentId,
            providerPaymentId,
          })),
        });
      });

      const payment = await Payment.findOne({ telegramPaymentId: paymentId });
      expect(payment!.providerPaymentId).toBe(providerPaymentId);
    });
  });
});
