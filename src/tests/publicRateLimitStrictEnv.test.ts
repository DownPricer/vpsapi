import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadEnv } from "../config/env";

describe("PUBLIC_RATE_LIMIT=strict exige BFF_SHARED_SECRET", () => {
  it("loadEnv refuse de démarrer sans secret en mode strict", () => {
    const prevLimit = process.env.PUBLIC_RATE_LIMIT;
    const prevSecret = process.env.BFF_SHARED_SECRET;
    process.env.PUBLIC_RATE_LIMIT = "strict";
    delete process.env.BFF_SHARED_SECRET;
    try {
      assert.throws(() => loadEnv(), /BFF_SHARED_SECRET|strict/i);
    } finally {
      if (prevLimit === undefined) delete process.env.PUBLIC_RATE_LIMIT;
      else process.env.PUBLIC_RATE_LIMIT = prevLimit;
      if (prevSecret === undefined) delete process.env.BFF_SHARED_SECRET;
      else process.env.BFF_SHARED_SECRET = prevSecret;
    }
  });
});
