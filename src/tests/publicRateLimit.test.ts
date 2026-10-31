import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRateLimiter } from "../middleware/rateLimit";

const SECRET = "a".repeat(32);

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

function req(opts: {
  ip: string;
  clientIp?: string;
  bffAuth?: string;
}) {
  const headers: Record<string, string> = {};
  if (opts.clientIp) headers["x-client-ip"] = opts.clientIp;
  if (opts.bffAuth) headers["x-bff-auth"] = opts.bffAuth;
  return {
    ip: opts.ip,
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
}

describe("PUBLIC_RATE_LIMIT — modes trusted / strict", () => {
  it("mode trusted : sans secret, pas de limite (site non mis à jour)", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      key: "contact",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "trusted",
    });
    let passed = 0;
    for (let i = 0; i < 5; i += 1) {
      limiter(req({ ip: "10.0.0.1", clientIp: "203.0.113.1" }), mockRes() as never, () => {
        passed += 1;
      });
    }
    assert.equal(passed, 5);
  });

  it("mode trusted : secret valide + X-Client-Ip → limite par IP visiteur", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      key: "contact",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "trusted",
    });
    let passed = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = mockRes();
      limiter(req({ ip: "10.0.0.1", clientIp: "203.0.113.50", bffAuth: SECRET }), r as never, () => {
        passed += 1;
      });
      if (i >= 2) assert.equal(r.code, 429);
    }
    assert.equal(passed, 2);
  });

  it("mode strict : appel direct sans secret limité par req.ip", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      key: "devis",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "strict",
    });
    let passed = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = mockRes();
      limiter(req({ ip: "198.51.100.1" }), r as never, () => {
        passed += 1;
      });
      if (i >= 2) assert.equal(r.code, 429);
    }
    assert.equal(passed, 2);
  });

  it("mode strict : X-Client-Ip falsifié sans secret est ignoré (clé = req.ip)", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      key: "reservation",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "strict",
    });
    // Même req.ip, X-Client-Ip différent à chaque fois → même bucket
    let passed = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = mockRes();
      limiter(
        req({ ip: "198.51.100.9", clientIp: `203.0.113.${i}` }),
        r as never,
        () => {
          passed += 1;
        }
      );
      if (i >= 2) assert.equal(r.code, 429);
    }
    assert.equal(passed, 2);
  });

  it("mode strict : secret valide → clé = IP visiteur (pas req.ip du BFF)", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      key: "calculer-tarif",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "strict",
    });
    const r1 = mockRes();
    let a = 0;
    limiter(
      req({ ip: "10.0.0.1", clientIp: "203.0.113.10", bffAuth: SECRET }),
      r1 as never,
      () => {
        a += 1;
      }
    );
    const r2 = mockRes();
    limiter(
      req({ ip: "10.0.0.1", clientIp: "203.0.113.10", bffAuth: SECRET }),
      r2 as never,
      () => {
        a += 1;
      }
    );
    assert.equal(r2.code, 429);
    assert.equal(a, 1);

    // Autre visiteur derrière le même BFF : non bloqué
    let b = 0;
    limiter(
      req({ ip: "10.0.0.1", clientIp: "203.0.113.99", bffAuth: SECRET }),
      mockRes() as never,
      () => {
        b += 1;
      }
    );
    assert.equal(b, 1);
  });

  it("mode off : jamais de limite", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      key: "contact",
      ipSource: "public",
      bffSharedSecret: SECRET,
      publicRateLimitMode: "off",
    });
    let passed = 0;
    for (let i = 0; i < 5; i += 1) {
      limiter(
        req({ ip: "10.0.0.1", clientIp: "1.1.1.1", bffAuth: SECRET }),
        mockRes() as never,
        () => {
          passed += 1;
        }
      );
    }
    assert.equal(passed, 5);
  });
});
