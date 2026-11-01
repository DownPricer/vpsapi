import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { createFailureCounter, createRateLimiter, purgeExpiredRateLimitEntries } from "../middleware/rateLimit";

function mockRes() {
  return {
    code: 0,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(c: number) {
      this.code = c;
      return this;
    },
    json() {
      return this;
    },
  };
}

describe("purge périodique des limiteurs en mémoire", () => {
  it("purgeExpiredRateLimitEntries retire les entrées expirées", () => {
    const limiter = createRateLimiter({
      windowMs: 50,
      max: 100,
      key: "purge-test",
      keyFrom: (req) => `purge-test:${(req as { ip?: string }).ip ?? "x"}`,
    });
    const failures = createFailureCounter({
      windowMs: 50,
      max: 100,
      keyPrefix: "purge-fail",
    });

    limiter({ ip: "1.1.1.1" } as Request, mockRes() as never, () => undefined);
    failures.recordFailure("a@b.c");
    assert.ok(failures._size() >= 1);

    const removed = purgeExpiredRateLimitEntries(Date.now() + 200);
    assert.ok(removed >= 1, `attendu au moins 1 entrée purgée, got ${removed}`);
    assert.equal(failures._size(), 0);
  });
});

describe("login email failures — succès remet à zéro", () => {
  it("une réussite ne consomme pas le quota et reset le compteur", () => {
    const counter = createFailureCounter({ windowMs: 60_000, max: 3, keyPrefix: "email-ok" });
    const email = "user@example.com";
    counter.recordFailure(email);
    counter.recordFailure(email);
    counter.reset(email);
    assert.equal(counter.isLimited(email).limited, false);
    // Après reset, on peut encore échouer max fois
    assert.equal(counter.recordFailure(email).limited, false);
    assert.equal(counter.recordFailure(email).limited, false);
    assert.equal(counter.recordFailure(email).limited, false);
    const over = counter.recordFailure(email);
    assert.equal(over.limited, true);
  });
});
