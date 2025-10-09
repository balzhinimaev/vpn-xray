import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";

import { createApp } from "../../../app.js";
import { JWTService } from "../../../auth/jwtService.js";
import { Traffic } from "../../../models/index.js";

const jwtService = new JWTService({
  secret: "test-secret-should-be-at-least-32-chars-long!!",
  accessExpiry: "1h",
  refreshExpiry: "7d",
});

const TELEGRAM_ID = "123456";
const USER_ID = "507f191e810c19729de860ea";

const baseServiceMock = {
  async getUserAccounts(telegramId: string) {
    if (telegramId !== TELEGRAM_ID) {
      return [];
    }

    return [
      {
        id: "acc-1",
        email: "user@example.com",
        link: "vless://example",
        remark: "Test account",
      },
    ];
  },
} as any;

function buildApp() {
  return createApp({
    service: baseServiceMock,
    jwtService,
    apiToken: "",
  });
}

test("GET /api/accounts returns accounts for an authenticated user", async () => {
  const app = buildApp();
  const token = jwtService.generateAccessToken(USER_ID, TELEGRAM_ID);

  const originalFindOne = Traffic.findOne;
  (Traffic as any).findOne = async () => null;

  try {
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/accounts`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.total, 1);
      assert.equal(body.accounts[0].id, "acc-1");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    (Traffic as any).findOne = originalFindOne;
  }
});

test("GET /api/accounts rejects requests without authentication", async () => {
  const app = buildApp();
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/accounts`;

  try {
    const response = await fetch(url);
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
