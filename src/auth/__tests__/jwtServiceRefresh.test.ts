import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";

import { JWTService } from "../jwtService.js";

const baseConfig = {
  secret: "0123456789abcdef0123456789abcdef",
  accessExpiry: "15m" as const,
  refreshExpiry: "7d" as const,
};

describe("JWTService refresh expiration helper", () => {
  it("calculates absolute expiration using the configured refresh TTL", () => {
    const service = new JWTService(baseConfig);
    const issuedAt = new Date("2024-01-01T00:00:00.000Z");

    const expiresAt = service.getRefreshExpiresAt(issuedAt);

    assert.equal(
      expiresAt.toISOString(),
      new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
  });

  it("matches the refresh token exp claim", () => {
    const service = new JWTService(baseConfig);
    const { refreshToken } = service.generateTokenPair(
      new Types.ObjectId(),
      "123456"
    );

    const payload = service.verifyRefreshToken(refreshToken);
    assert.ok(payload.exp, "Refresh token payload should include exp");
    assert.ok(payload.iat, "Refresh token payload should include iat");

    const helperExpires = service.getRefreshExpiresAt(
      new Date((payload.iat as number) * 1000)
    );

    assert.equal(helperExpires.getTime(), (payload.exp as number) * 1000);
  });
});
