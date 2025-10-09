import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateTelegramInitData } from "../../auth/telegramAuth.js";

const botToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
const sampleInitData =
  "auth_date=1620000000" +
  "&query_id=AAH4J0dKAwAAAK2HUwABAA" +
  "&user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22John%22%2C%22last_name%22%3A%22Doe%22%2C%22username%22%3A%22johndoe%22%2C%22language_code%22%3A%22en%22%7D" +
  "&hash=4546073e0393bb70b5bf8cfe7bd1114a54224a1d9abdea70970481bd6d8e9718";

describe("validateTelegramInitData", () => {
  it("accepts the sample initData provided in Telegram docs", () => {
    const parsed = validateTelegramInitData(
      sampleInitData,
      botToken,
      Number.MAX_SAFE_INTEGER
    );

    assert.equal(parsed.auth_date, 1620000000);
    assert.equal(parsed.user.id, 123456789);
  });

  it("rejects tampered auth_date values", () => {
    const tamperedInitData = sampleInitData.replace(
      "auth_date=1620000000",
      "auth_date=1620000001"
    );

    assert.throws(() => {
      validateTelegramInitData(tamperedInitData, botToken, Number.MAX_SAFE_INTEGER);
    }, /Invalid initData signature/);
  });
});
