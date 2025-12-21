import { Session } from "../index.js";

describe("Session schema", () => {
  it("defines a TTL index on expiresAt", () => {
    const indexes = Session.schema.indexes();
    const ttlIndex = indexes.find(([fields]) => fields.expiresAt === 1);

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.[1]?.expireAfterSeconds).toBe(0);
  });
});
