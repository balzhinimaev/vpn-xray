import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";

import { createApp } from "../../../app.js";
import { JWTService } from "../../../auth/jwtService.js";

const jwtService = new JWTService({
  secret: "test-secret-should-be-at-least-32-chars-long!!",
  accessExpiry: "1h",
  refreshExpiry: "7d",
});

const API_TOKEN = "test-api-token";

function createServiceMock() {
  const inbound = {
    tag: "vless-inbound",
    port: 443,
    security: "tls",
    network: "tcp",
    sni: "vpn.example.com",
    pbk: undefined,
    path: undefined,
    hostHeader: undefined,
  };

  const mock = {
    inbound,
    lastCreateInput: null as any,
    lastDeletedEmail: null as string | null,
    lastTrafficArgs: null as { email: string; reset: boolean } | null,
    getInboundInfo() {
      return inbound;
    },
    getPublicHost() {
      return "public.example.com";
    },
    async createAdminUser(input: any) {
      mock.lastCreateInput = input;
      return {
        id: input.email,
        uuid: "generated-uuid",
        email: input.email,
        inboundTag: inbound.tag,
        port: inbound.port,
        security: inbound.security,
        link: "vless://generated",
        raw: {},
      };
    },
    async deleteUserByEmail(email: string) {
      mock.lastDeletedEmail = email;
    },
    async getTrafficByEmail(email: string, reset: boolean = false) {
      mock.lastTrafficArgs = { email, reset };
      return {
        email,
        uplink: 100,
        downlink: 200,
        total: 300,
        resetApplied: reset,
      };
    },
  };

  return mock;
}

function buildApp(serviceMock: any) {
  return createApp({
    service: serviceMock,
    jwtService,
    apiToken: API_TOKEN,
  });
}

async function withServer(app: ReturnType<typeof buildApp>, cb: (url: string) => Promise<void>) {
  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await cb(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /info returns inbound details when authorized", async () => {
  const serviceMock = createServiceMock();
  const app = buildApp(serviceMock as any);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/info`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.inboundTag, serviceMock.inbound.tag);
    assert.equal(body.port, serviceMock.inbound.port);
  });
});

test("POST /users creates a user with provided email", async () => {
  const serviceMock = createServiceMock();
  const app = buildApp(serviceMock as any);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "admin@example.com", flow: "xtls-rprx-vision" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.email, "admin@example.com");
    assert.equal(serviceMock.lastCreateInput.email, "admin@example.com");
    assert.equal(serviceMock.lastCreateInput.flow, "xtls-rprx-vision");
  });
});

test("GET /users/:email/traffic proxies traffic data", async () => {
  const serviceMock = createServiceMock();
  const app = buildApp(serviceMock as any);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/users/admin%40example.com/traffic?reset=true`,
      {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.email, "admin@example.com");
    assert.equal(body.resetApplied, true);
    assert.equal(serviceMock.lastTrafficArgs?.email, "admin@example.com");
    assert.equal(serviceMock.lastTrafficArgs?.reset, true);
  });
});

test("DELETE /users/:email removes the user via service", async () => {
  const serviceMock = createServiceMock();
  const app = buildApp(serviceMock as any);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/admin%40example.com`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(serviceMock.lastDeletedEmail, "admin@example.com");
  });
});

test("/users endpoints require API token", async () => {
  const serviceMock = createServiceMock();
  const app = buildApp(serviceMock as any);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "missing-auth@example.com" }),
    });

    assert.equal(response.status, 401);
    assert.equal(serviceMock.lastCreateInput, null);
  });
});
