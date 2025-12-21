import { AddressInfo } from "node:net";

import { createApp } from "../../../app.js";
import { JWTService } from "../../../auth/jwtService.js";

const jwtService = new JWTService({
  secret: "test-secret-should-be-at-least-32-chars-long!!",
  accessExpiry: "1h",
  refreshExpiry: "7d",
});

const BOT_SECRET = "bot-secret";

function buildApp() {
  return createApp({
    service: {} as any,
    jwtService,
    apiToken: "",
    botRegistrationSecret: BOT_SECRET,
  });
}

async function withServer(app: ReturnType<typeof buildApp>, cb: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await cb(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("POST /bot/payments/stars rejects missing bot secret", async () => {
  const app = buildApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bot/payments/stars`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });
});

test("POST /bot/payments/stars validates plan amount", async () => {
  const app = buildApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bot/payments/stars`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": BOT_SECRET,
      },
      body: JSON.stringify({
        telegramId: "123456",
        paymentId: "tg_pay_1",
        totalAmount: 50,
        currency: "XTR",
        period: "2weeks",
        invoicePayload: JSON.stringify({ period: "2weeks" }),
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_AMOUNT");
  });
});
