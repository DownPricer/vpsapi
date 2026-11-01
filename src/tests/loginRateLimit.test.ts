import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import {
  createFailureCounter,
  createRateLimiter,
  resolveTrustedProxyIp,
} from "../middleware/rateLimit";

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

function loginEmail(req: { body?: { email?: unknown } }): string {
  return typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
}

/** Stack IP (middleware) + plafond e-mail sur échecs seulement. */
function buildLoginStack(opts?: { ipMax?: number; emailMax?: number }) {
  const ipMax = opts?.ipMax ?? 20;
  const emailMax = opts?.emailMax ?? 10;
  const byIp = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: ipMax,
    key: "auth-login-ip",
    keyFrom: (req) => `auth-login-ip:${resolveTrustedProxyIp(req)}:${loginEmail(req) || "noemail"}`,
  });
  const emailFails = createFailureCounter({
    windowMs: 15 * 60 * 1000,
    max: emailMax,
    keyPrefix: "auth-login-email-fail-test",
  });
  return function stack(req: Request, res: ReturnType<typeof mockRes>, next: () => void) {
    byIp(req, res as never, (err?: unknown) => {
      if (err) return;
      if (res.code === 429) return;
      const email = loginEmail(req);
      if (email) {
        const state = emailFails.isLimited(email);
        if (state.limited) {
          res.setHeader("Retry-After", String(state.retryAfterSec));
          res.status(429).json();
          return;
        }
        // Simule un échec de login pour le test plafond e-mail
        const after = emailFails.recordFailure(email);
        if (after.limited) {
          res.setHeader("Retry-After", String(after.retryAfterSec));
          res.status(429).json();
          return;
        }
      }
      next();
    });
  };
}

function spoofingReq(ip: string, email: string, spoofIp: string): Request {
  const headers: Record<string, string> = {
    "x-client-ip": spoofIp,
    "x-forwarded-for": spoofIp,
  };
  return {
    ip,
    body: { email },
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
}

describe("login rate-limit — IP fiable + plafond e-mail", () => {
  it("ignore X-Client-Ip / X-Forwarded-For : l'attaquant qui spoofe reste bloqué par req.ip", () => {
    const stack = buildLoginStack({ ipMax: 3, emailMax: 100 });
    let passed = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = mockRes();
      stack(spoofingReq("9.9.9.9", "victim@example.com", `203.0.113.${i}`), r as never, () => {
        passed += 1;
      });
      if (i >= 3) {
        assert.equal(r.code, 429, `tentative ${i + 1} doit être 429 malgré spoof`);
        assert.ok(r.headers["Retry-After"]);
      }
    }
    assert.equal(passed, 3);
  });

  it("plafond par e-mail seul : multi-IP ne contourne pas (10 max)", () => {
    const stack = buildLoginStack({ ipMax: 100, emailMax: 10 });
    let passed = 0;
    for (let i = 0; i < 12; i += 1) {
      const r = mockRes();
      stack(
        {
          ip: `10.0.0.${i + 1}`,
          body: { email: "same@example.com" },
          header: () => undefined,
        } as never,
        r as never,
        () => {
          passed += 1;
        }
      );
      if (i >= 10) {
        assert.equal(r.code, 429);
        assert.ok(r.headers["Retry-After"]);
      }
    }
    assert.equal(passed, 10);
  });

  it("un utilisateur légitime n'est pas bloqué par les tentatives sur un autre e-mail", () => {
    const stack = buildLoginStack({ ipMax: 5, emailMax: 5 });
    for (let i = 0; i < 5; i += 1) {
      stack(
        { ip: "1.1.1.1", body: { email: "attacker@x.com" }, header: () => undefined } as never,
        mockRes() as never,
        () => undefined
      );
    }
    const blocked = mockRes();
    stack(
      { ip: "1.1.1.1", body: { email: "attacker@x.com" }, header: () => undefined } as never,
      blocked as never,
      () => undefined
    );
    assert.equal(blocked.code, 429);

    let legit = 0;
    const ok = mockRes();
    stack(
      { ip: "1.1.1.1", body: { email: "legit@x.com" }, header: () => undefined } as never,
      ok as never,
      () => {
        legit += 1;
      }
    );
    assert.equal(ok.code, 0);
    assert.equal(legit, 1);
  });

  it("resolveTrustedProxyIp n'utilise jamais les en-têtes client", () => {
    const req = {
      ip: "198.51.100.10",
      header: (name: string) => {
        if (name.toLowerCase() === "x-client-ip") return "203.0.113.1";
        if (name.toLowerCase() === "x-forwarded-for") return "203.0.113.2";
        return undefined;
      },
    } as never;
    assert.equal(resolveTrustedProxyIp(req), "198.51.100.10");
  });
});
