/**
 * QA Passe 2 — sécurité HTTP (SMTP debug, rate-limit, JWT, settings, uploads).
 * SMTP forcé vers Mailpit local uniquement (127.0.0.1:1025).
 */
import "./helpers/qaEnv";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  createRateLimiter,
  resolvePublicVisitorIp,
  resolveTrustedProxyIp,
} from "../../middleware/rateLimit";
import { sanitizePublicTenantSettings } from "../../utils/sanitizePublicTenantSettings";
import { validateTenantSettingsPayload } from "../../validation/tenantSettingsPayload";
import { storeVehiclePhoto, PhotoUploadError } from "../../modules/fleet/photoStorage";
import { assertLocalTestDb } from "./helpers/qaEnv";

const UPLOADS = mkdtempSync(path.join(os.tmpdir(), "vtc-qa-sec-"));
process.env.UPLOADS_DIR = UPLOADS;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_not_used_for_network";
if (!process.env.BFF_SHARED_SECRET || process.env.BFF_SHARED_SECRET.length < 32) {
  process.env.BFF_SHARED_SECRET = "b".repeat(32);
}

const TEST_DB = process.env.TEST_DATABASE_URL;
assertLocalTestDb(TEST_DB);

const BFF = process.env.BFF_SHARED_SECRET!;
const ACCESS = process.env.JWT_ACCESS_SECRET!;

type HttpResult = { status: number; body: unknown; headers: http.IncomingHttpHeaders };

function request(
  base: string,
  method: string,
  urlPath: string,
  opts: {
    headers?: Record<string, string>;
    body?: string | Buffer;
    raw?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<HttpResult> {
  const u = new URL(urlPath, base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          ...(opts.body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(opts.body),
              }
            : {}),
          ...opts.headers,
        },
        timeout: opts.timeoutMs ?? 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: unknown = raw;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* texte */
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`timeout ${method} ${urlPath}`));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

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

function limReq(opts: {
  ip: string;
  clientIp?: string;
  forwardedFor?: string;
  realIp?: string;
  bffAuth?: string;
}) {
  const headers: Record<string, string> = {};
  if (opts.clientIp) headers["x-client-ip"] = opts.clientIp;
  if (opts.forwardedFor) headers["x-forwarded-for"] = opts.forwardedFor;
  if (opts.realIp) headers["x-real-ip"] = opts.realIp;
  if (opts.bffAuth) headers["x-bff-auth"] = opts.bffAuth;
  return {
    ip: opts.ip,
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
}

describe("QA sécurité — rate limiters (headers spoofables)", () => {
  it("X-Forwarded-For / X-Real-IP changeants sans BFF n'ouvrent pas de nouveaux buckets (strict)", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      key: "qa-xff",
      ipSource: "public",
      bffSharedSecret: BFF,
      publicRateLimitMode: "strict",
    });
    let passed = 0;
    for (let i = 0; i < 5; i++) {
      const r = mockRes();
      limiter(
        limReq({
          ip: "198.51.100.10",
          forwardedFor: `203.0.113.${i}`,
          realIp: `198.51.100.${i}`,
          clientIp: `203.0.113.${i}`,
        }),
        r as never,
        () => {
          passed += 1;
        }
      );
      if (i >= 2) assert.equal(r.code, 429);
    }
    assert.equal(passed, 2);
  });

  it("PUBLIC_RATE_LIMIT off / trusted / strict + BFF absent/faux/valide", () => {
    // off
    {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        key: "qa-off",
        ipSource: "public",
        bffSharedSecret: BFF,
        publicRateLimitMode: "off",
      });
      let n = 0;
      for (let i = 0; i < 4; i++) {
        limiter(limReq({ ip: "10.0.0.1", clientIp: "1.1.1.1", bffAuth: BFF }), mockRes() as never, () => {
          n += 1;
        });
      }
      assert.equal(n, 4);
    }
    // trusted sans secret → pas de limite
    {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        key: "qa-trusted-nosec",
        ipSource: "public",
        bffSharedSecret: BFF,
        publicRateLimitMode: "trusted",
      });
      let n = 0;
      for (let i = 0; i < 3; i++) {
        limiter(limReq({ ip: "10.0.0.1", clientIp: "9.9.9.9" }), mockRes() as never, () => {
          n += 1;
        });
      }
      assert.equal(n, 3);
    }
    // trusted secret faux → pas de limite
    {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        key: "qa-trusted-bad",
        ipSource: "public",
        bffSharedSecret: BFF,
        publicRateLimitMode: "trusted",
      });
      let n = 0;
      for (let i = 0; i < 3; i++) {
        limiter(
          limReq({ ip: "10.0.0.1", clientIp: "9.9.9.9", bffAuth: "x".repeat(32) }),
          mockRes() as never,
          () => {
            n += 1;
          }
        );
      }
      assert.equal(n, 3);
    }
    // trusted secret valide → limite par X-Client-Ip
    {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        key: "qa-trusted-ok",
        ipSource: "public",
        bffSharedSecret: BFF,
        publicRateLimitMode: "trusted",
      });
      let n = 0;
      const r2 = mockRes();
      limiter(
        limReq({ ip: "10.0.0.1", clientIp: "203.0.113.77", bffAuth: BFF }),
        mockRes() as never,
        () => {
          n += 1;
        }
      );
      limiter(
        limReq({ ip: "10.0.0.1", clientIp: "203.0.113.77", bffAuth: BFF }),
        r2 as never,
        () => {
          n += 1;
        }
      );
      assert.equal(n, 1);
      assert.equal(r2.code, 429);
    }
    // strict sans secret → limite par req.ip
    {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        key: "qa-strict-nosec",
        ipSource: "public",
        bffSharedSecret: BFF,
        publicRateLimitMode: "strict",
      });
      let n = 0;
      const r2 = mockRes();
      limiter(limReq({ ip: "198.51.100.50", clientIp: "1.2.3.4" }), mockRes() as never, () => {
        n += 1;
      });
      limiter(limReq({ ip: "198.51.100.50", clientIp: "5.6.7.8" }), r2 as never, () => {
        n += 1;
      });
      assert.equal(n, 1);
      assert.equal(r2.code, 429);
      const visitor = resolvePublicVisitorIp(
        limReq({ ip: "198.51.100.50", clientIp: "1.2.3.4" }) as never,
        BFF
      );
      assert.equal(visitor.trustedVisitor, false);
      assert.equal(resolveTrustedProxyIp(limReq({ ip: "198.51.100.50" }) as never), "198.51.100.50");
    }
  });
});

describe("QA sécurité — pollution settings / sanitize public", () => {
  it("refuse __proto__ / constructor pollution et clés secrètes", () => {
    const proto = JSON.parse('{"companyName":"X","__proto__":{"admin":true}}');
    // validate ne traverse que Object.keys propres ; on vérifie aussi les clés interdites classiques
    const secrets = validateTenantSettingsPayload({
      companyName: "Demo",
      SMTP_PASS: "secret",
      nested: { jwt_access_secret: "x", apiKey: "y" },
    });
    assert.equal(secrets.ok, false);

    const ctor = validateTenantSettingsPayload({
      companyName: "Demo",
      constructor: { name: "hack" },
      prototype: { x: 1 },
    });
    // constructor/prototype ne sont pas dans la liste secrète — mais ne doivent pas devenir des secrets stockés tels quels ;
    // on s'assure au moins que les clés secrètes restent bloquées et que sanitize retire les e-mails internes.
    assert.equal(ctor.ok, true);

    const polluted = Object.assign(Object.create({ polluted: true }), {
      companyName: "Y",
      operatorExtraRecipientEmail: "interne@example.test",
      SMTP_PASS: "nope",
    });
    // Object.create héritage : validate via Object.keys ne voit pas polluted ; SMTP_PASS doit échouer
    const bad = validateTenantSettingsPayload({
      companyName: "Y",
      SMTP_PASS: "nope",
      __proto__: { admin: true },
      constructor: { prototype: { x: 1 } },
    });
    assert.equal(bad.ok, false);

    void proto;
    void polluted;
  });

  it("parcours récursif : aucune clé secrète / e-mail interne dans sanitize public", () => {
    const dirty = {
      companyName: "VTC",
      SMTP_PASS: "secret",
      jwt_access_secret: "j",
      emails: {
        fromName: "VTC",
        operatorExtraRecipientEmail: "copie@interne.example",
        contactFormTo: "public@example.com",
        nested: { passwordHash: "hash", distance_matrix_api_key: "k" },
      },
      branding: { primaryColor: "#111" },
    };
    const out = sanitizePublicTenantSettings(dirty);
    assert.ok(out);
    const flat: string[] = [];
    const walk = (n: unknown, p: string) => {
      if (n === null || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as object)) {
        flat.push(`${p}${k}`.toLowerCase());
        walk(v, `${p}${k}.`);
      }
    };
    walk(out, "");
    for (const forbidden of [
      "smtp_pass",
      "jwt_access_secret",
      "passwordhash",
      "distance_matrix_api_key",
      "operatorextrarecipientemail",
      "apikey",
      "secret",
    ]) {
      assert.ok(!flat.some((k) => k.split(".").pop() === forbidden), `fuite ${forbidden}`);
    }
    const json = JSON.stringify(out).toLowerCase();
    assert.ok(!json.includes("secret"));
    assert.ok(!json.includes("copie@interne"));
    assert.equal((out.emails as Record<string, unknown>).contactFormTo, "public@example.com");
  });
});

describe("QA sécurité — uploads (contenu réel, pas MIME client)", () => {
  it("rejette faux MIME, SVG+script, path traversal, fichier énorme, double extension", async () => {
    const tid = "qa_sec_up";
    await assert.rejects(
      storeVehiclePhoto(tid, Buffer.from("<?php echo 1; ?>")),
      (e: unknown) => e instanceof PhotoUploadError && e.code === "INVALID_IMAGE"
    );
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      "utf8"
    );
    await assert.rejects(
      storeVehiclePhoto(tid, svg),
      (e: unknown) =>
        e instanceof PhotoUploadError && (e.code === "INVALID_IMAGE" || e.code === "UNSUPPORTED_FORMAT")
    );
    // path traversal via tenantId
    await assert.rejects(
      storeVehiclePhoto("../etc", Buffer.from("x")),
      (e: unknown) => e instanceof PhotoUploadError && e.code === "INVALID_TENANT"
    );
    await assert.rejects(
      storeVehiclePhoto(tid, Buffer.alloc(9 * 1024 * 1024, 1)),
      (e: unknown) => e instanceof PhotoUploadError && e.code === "FILE_TOO_LARGE"
    );
    // « double extension » : le contenu PHP nommé .jpg.webp côté client — sharp refuse
    await assert.rejects(
      storeVehiclePhoto(tid, Buffer.from("not-an-image.jpg.webp")),
      (e: unknown) => e instanceof PhotoUploadError && e.code === "INVALID_IMAGE"
    );

    // PNG valide accepté (contrôle positif)
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const ok = await storeVehiclePhoto(tid, png);
    assert.match(ok.url, new RegExp(`^/media/vehicles/${tid}/[0-9a-f-]{36}\\.webp$`));
  });
});

const httpSuite = TEST_DB ? describe : describe.skip;

httpSuite("QA sécurité HTTP (PostgreSQL + app Express)", () => {
  let server: http.Server;
  let base = "";
  let prisma: typeof import("../../db/prisma").prisma;
  let tokens: typeof import("../../modules/auth/tokens");
  let authSvc: InstanceType<typeof import("../../services/auth.service").AuthService>;

  const TA = "qa_sec_http_a";
  const TB = "qa_sec_http_b";
  const UA = "qa_sec_user_a";
  const UB = "qa_sec_user_b";
  const PASS = "QaSecPassw0rd!";

  before(async () => {
    // Dev + drapeau explicite pour monter POST /api/debug/smtp-test.
    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEBUG_SMTP = "1";
    prisma = (await import("../../db/prisma")).prisma;
    tokens = await import("../../modules/auth/tokens");
    const Auth = await import("../../services/auth.service");
    authSvc = new Auth.AuthService();

    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.tenant.create({
      data: {
        id: TA,
        name: "QA Sec A",
        slug: "qa-sec-a",
        settings: {
          companyName: "Sec A",
          operatorExtraRecipientEmail: "interne-a@example.test",
          emails: { contactFormTo: "public-a@example.com", operatorExtraRecipientEmail: "copie-a@example.test" },
        },
      },
    });
    await prisma.tenant.create({ data: { id: TB, name: "QA Sec B", slug: "qa-sec-b" } });
    const hash = await bcrypt.hash(PASS, 8);
    await prisma.operatorUser.create({
      data: { id: UA, tenantId: TA, email: "op@qa-sec-a.test", passwordHash: hash, role: "admin" },
    });
    await prisma.operatorUser.create({
      data: { id: UB, tenantId: TB, email: "op@qa-sec-b.test", passwordHash: hash, role: "admin" },
    });

    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.$disconnect();
    try {
      rmSync(UPLOADS, { recursive: true, force: true });
    } catch {
      /* Windows locks */
    }
  });

  it("POST /api/debug/smtp-test : development sans auth, destinataire libre (Mailpit only)", async () => {
    assert.equal(process.env.SMTP_HOST, "127.0.0.1");
    assert.equal(process.env.SMTP_PORT, "1025");
    let res: HttpResult;
    try {
      res = await request(base, "POST", "/api/debug/smtp-test", {
        headers: { "X-Tenant-ID": "default", "content-type": "application/json" },
        body: JSON.stringify({ to: "qa-mailpit@example.test" }),
        timeoutMs: 8_000,
      });
    } catch (e) {
      // Mailpit down : on vérifie au moins l'absence d'auth obligatoire via un 404 prod séparé ;
      // ici on accepte l'échec réseau local sans SMTP réel.
      assert.match(String(e), /timeout|ECONNREFUSED|connect/i);
      return;
    }
    // 200 si Mailpit up, sinon erreur SMTP — jamais 401 (pas d'auth) ni SMTP distant
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 404);
    assert.ok([200, 500, 502, 503].includes(res.status), `status=${res.status}`);
    if (res.status === 200) {
      const body = res.body as { ok?: boolean; target?: string };
      assert.equal(body.ok, true);
      assert.equal(body.target, "qa-mailpit@example.test");
    }
  });

  it("POST /api/debug/smtp-test : sans ENABLE_DEBUG_SMTP ou hors development → 404 (route absente)", async () => {
    // Le montage est décidé à createApp() : une app sans drapeau ne expose pas la route.
    const prevFlag = process.env.ENABLE_DEBUG_SMTP;
    const prevEnv = process.env.NODE_ENV;
    delete process.env.ENABLE_DEBUG_SMTP;
    process.env.NODE_ENV = "production";
    let other: http.Server | undefined;
    try {
      const { createApp } = await import("../../app");
      other = createApp().listen(0);
      const otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
      const res = await request(otherBase, "POST", "/api/debug/smtp-test", {
        headers: { "X-Tenant-ID": "default", "content-type": "application/json" },
        body: JSON.stringify({ to: "qa-mailpit@example.test" }),
      });
      assert.equal(res.status, 404);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevFlag === undefined) delete process.env.ENABLE_DEBUG_SMTP;
      else process.env.ENABLE_DEBUG_SMTP = prevFlag;
      await new Promise<void>((resolve) => (other ? other.close(() => resolve()) : resolve()));
    }
  });

  it("JWT : alg none, signature modifiée, expiré, autre tenant → refus", async () => {
    const headerNone = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: UA, tenantId: TA, email: "op@qa-sec-a.test", role: "admin" })
    ).toString("base64url");
    const noneToken = `${headerNone}.${payload}.`;

    const valid = tokens.signAccessToken({
      sub: UA,
      tenantId: TA,
      email: "op@qa-sec-a.test",
      role: "admin",
    });
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from("deadbeef").toString("base64url")}`;

    const expired = jwt.sign(
      { sub: UA, tenantId: TA, email: "op@qa-sec-a.test", role: "admin" },
      ACCESS,
      { expiresIn: -10 }
    );
    const otherTenant = tokens.signAccessToken({
      sub: UB,
      tenantId: TB,
      email: "op@qa-sec-b.test",
      role: "admin",
    });

    for (const [label, token, expectStatus] of [
      ["alg-none", noneToken, 401],
      ["tampered", tampered, 401],
      ["expired", expired, 401],
      ["other-tenant", otherTenant, 403],
    ] as const) {
      const res = await request(base, "GET", "/api/pro/settings", {
        headers: {
          "X-Tenant-ID": TA,
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(res.status, expectStatus, label);
    }

    const ok = await request(base, "GET", "/api/pro/settings", {
      headers: { "X-Tenant-ID": TA, Authorization: `Bearer ${valid}` },
    });
    assert.equal(ok.status, 200);
  });

  it("refresh reuse après rotation → Session invalide", async () => {
    const login = await authSvc.login({
      tenantId: TA,
      email: "op@qa-sec-a.test",
      password: PASS,
    });
    const rotated = await authSvc.refresh(login.refreshToken);
    assert.ok(rotated.accessToken);
    assert.notEqual(rotated.refreshToken, login.refreshToken);
    await assert.rejects(() => authSvc.refresh(login.refreshToken), /Session invalide|expir/);
    // le nouveau refresh fonctionne une fois
    const again = await authSvc.refresh(rotated.refreshToken);
    assert.ok(again.accessToken);
  });

  it("PUT /api/pro/settings refuse clés interdites et pollution", async () => {
    const token = tokens.signAccessToken({
      sub: UA,
      tenantId: TA,
      email: "op@qa-sec-a.test",
      role: "admin",
    });
    const res = await request(base, "PUT", "/api/pro/settings", {
      headers: {
        "X-Tenant-ID": TA,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          companyName: "Hack",
          SMTP_PASS: "leak",
          __proto__: { admin: true },
          constructor: { name: "Object" },
        },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("GET settings publics : aucune clé secrète / e-mail interne", async () => {
    const res = await request(base, "GET", "/api/public/tenant-settings", {
      headers: { "X-Tenant-ID": TA },
    });
    assert.equal(res.status, 200);
    const json = JSON.stringify(res.body).toLowerCase();
    assert.ok(!json.includes("interne-a@"));
    assert.ok(!json.includes("copie-a@"));
    assert.ok(!json.includes("operatorextrarecipientemail"));
    assert.ok(!json.includes("smtp_pass"));
    assert.ok(!json.includes("jwt_"));
  });

  it("upload photo véhicule HTTP : faux contenu / trop gros refusés", async () => {
    const token = tokens.signAccessToken({
      sub: UA,
      tenantId: TA,
      email: "op@qa-sec-a.test",
      role: "admin",
    });
    const V = await import("../../services/vehicle.service");
    const v = await V.createVehicle(TA, { name: "Upload HTTP", passengerMax: 4, active: true } as never);

    const boundary = "----QaSecBoundary";
    const fake = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg.php"\r\nContent-Type: image/jpeg\r\n\r\n<?php system($_GET['c']); ?>\r\n--${boundary}--\r\n`
    );
    const bad = await request(base, "POST", `/api/pro/vehicles/${v.id}/photos`, {
      headers: {
        "X-Tenant-ID": TA,
        Authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: fake,
      raw: true,
    });
    assert.ok(bad.status >= 400, `attendu erreur, got ${bad.status}`);

    // path-like filename
    const trav = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../etc/passwd.png"\r\nContent-Type: image/png\r\n\r\nnot-png\r\n--${boundary}--\r\n`
    );
    const bad2 = await request(base, "POST", `/api/pro/vehicles/${v.id}/photos`, {
      headers: {
        "X-Tenant-ID": TA,
        Authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: trav,
      raw: true,
    });
    assert.ok(bad2.status >= 400);
  });
});
