import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEV_JWT_ACCESS_SECRET,
  DEV_JWT_REFRESH_SECRET,
  loadEnv,
} from "../config/env";

const KEYS = [
  "NODE_ENV",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function snapshotEnv(): void {
  for (const k of KEYS) saved[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  restoreEnv();
});

describe("secrets JWT (loadEnv)", () => {
  it("en développement : accepte les valeurs par défaut avec avertissement", () => {
    snapshotEnv();
    process.env.NODE_ENV = "development";
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const env = loadEnv();
      assert.equal(env.jwtAccessSecret, DEV_JWT_ACCESS_SECRET);
      assert.equal(env.jwtRefreshSecret, DEV_JWT_REFRESH_SECRET);
      assert.ok(warnings.some((w) => w.includes("secrets JWT de développement")));
    } finally {
      console.warn = original;
    }
  });

  it("hors développement : refuse l'absence de secrets", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    assert.throws(() => loadEnv(), /obligatoires hors développement/);
  });

  it("hors développement : refuse les valeurs de développement", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = DEV_JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = DEV_JWT_REFRESH_SECRET;
    assert.throws(() => loadEnv(), /valeurs de développement/);
  });

  it("hors développement : refuse des secrets identiques", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    const same = "a".repeat(40);
    process.env.JWT_ACCESS_SECRET = same;
    process.env.JWT_REFRESH_SECRET = same;
    assert.throws(() => loadEnv(), /doivent être distincts/);
  });

  it("hors développement : refuse des secrets trop courts", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "short-access-secret-only";
    process.env.JWT_REFRESH_SECRET = "short-refresh-secret-only";
    assert.throws(() => loadEnv(), /au moins 32 caractères/);
  });

  it("hors développement : accepte des secrets valides", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "prod-access-secret-at-least-32-chars!!";
    process.env.JWT_REFRESH_SECRET = "prod-refresh-secret-at-least-32-chars!";
    const env = loadEnv();
    assert.equal(env.jwtAccessSecret, process.env.JWT_ACCESS_SECRET);
    assert.equal(env.jwtRefreshSecret, process.env.JWT_REFRESH_SECRET);
  });

  it("n'inclut jamais la valeur du secret dans le message d'erreur", () => {
    snapshotEnv();
    process.env.NODE_ENV = "production";
    const secret = "super-secret-value-that-must-not-leak!!!!";
    process.env.JWT_ACCESS_SECRET = secret;
    process.env.JWT_REFRESH_SECRET = secret;
    try {
      loadEnv();
      assert.fail("attendu throw");
    } catch (e) {
      const msg = String((e as Error).message);
      assert.ok(!msg.includes(secret));
    }
  });
});
