import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Session } from "../index.js";

describe("Session schema", () => {
  it("defines a TTL index on expiresAt", () => {
    const indexes = Session.schema.indexes();
    const ttlIndex = indexes.find(([fields]) => fields.expiresAt === 1);

    assert.ok(ttlIndex, "TTL index on expiresAt should be defined");
    assert.equal(ttlIndex?.[1]?.expireAfterSeconds, 0);
  });
});
