import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTokenExpiry,
  generateBookingToken,
  hashBookingToken,
  isPlausibleBookingToken,
} from "../services/bookingAccess.service";
import {
  buildPolicySnapshot,
  cancellationPolicyInputSchema,
  isPolicyContentEmpty,
  nextPolicy,
  parseStoredPolicy,
  parseStoredSnapshot,
  policyCheckoutMessage,
  policyLines,
} from "../services/cancellationPolicy";
import { createRateLimiter } from "../middleware/rateLimit";

describe("jeton d'accès client", () => {
  it("jeton aléatoire long, hash SHA-256 stable, jamais le jeton en clair", () => {
    const a = generateBookingToken();
    const b = generateBookingToken();
    assert.notEqual(a, b);
    assert.ok(isPlausibleBookingToken(a));
    assert.equal(hashBookingToken(a), hashBookingToken(a));
    assert.notEqual(hashBookingToken(a), a);
    assert.match(hashBookingToken(a), /^[0-9a-f]{64}$/);
  });

  it("refuse les formats invalides (identifiant de réservation, injection, trop court)", () => {
    for (const bad of ["clx123abc", "", "x".repeat(10), "../../etc/passwd" + "a".repeat(30), null, undefined, 42, "a b".repeat(20)]) {
      assert.equal(isPlausibleBookingToken(bad), false, String(bad));
    }
  });

  it("expiration : 48 h après la course, entre 7 jours et 1 an", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const day = 24 * 3600 * 1000;
    assert.equal(computeTokenExpiry(now, null).getTime() - now.getTime(), 7 * day);
    const ride = new Date(now.getTime() + 20 * day);
    assert.equal(computeTokenExpiry(now, ride).getTime(), ride.getTime() + 2 * day);
    assert.equal(computeTokenExpiry(now, new Date(now.getTime() - 10 * day)).getTime() - now.getTime(), 7 * day);
    assert.equal(computeTokenExpiry(now, new Date(now.getTime() + 900 * day)).getTime() - now.getTime(), 365 * day);
  });
});

describe("conditions d'annulation", () => {
  const input = cancellationPolicyInputSchema.parse({
    freeCancellationHours: 24,
    partialRefundConditions: "50 % entre 24 h et 6 h avant le départ.",
    lateCancellationConditions: "",
    specialReasons: "Retard de vol : annulation gratuite.",
    customerText: "",
  });

  it("valide et borne les champs", () => {
    assert.throws(() => cancellationPolicyInputSchema.parse({ freeCancellationHours: -1 }));
    assert.throws(() => cancellationPolicyInputSchema.parse({ freeCancellationHours: 24, unknown: "x" }));
    assert.equal(isPolicyContentEmpty(cancellationPolicyInputSchema.parse({ freeCancellationHours: null })), true);
    assert.equal(isPolicyContentEmpty(input), false);
  });

  it("chaque modification crée une nouvelle version sans toucher aux instantanés existants", () => {
    const v1 = nextPolicy(input, null, new Date("2026-01-01T00:00:00Z"));
    const snapshot = buildPolicySnapshot(v1, "reservation", new Date("2026-01-02T00:00:00Z"));
    const v2 = nextPolicy({ ...input, freeCancellationHours: 48 }, v1, new Date("2026-06-01T00:00:00Z"));

    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    const stored = parseStoredSnapshot(JSON.parse(JSON.stringify(snapshot)));
    assert.equal(stored?.policy.version, 1);
    assert.equal(stored?.policy.freeCancellationHours, 24); // la réservation garde ses conditions d'origine
  });

  it("sans politique enregistrée : pas d'instantané (gestion manuelle)", () => {
    assert.equal(buildPolicySnapshot(null, "reservation"), null);
    assert.equal(parseStoredPolicy(null), null);
    assert.equal(parseStoredSnapshot({}), null);
  });

  it("lignes affichables et message Checkout limité en taille", () => {
    const lines = policyLines(input);
    assert.deepEqual(lines.map((l) => l.label), ["Annulation gratuite", "Remboursement partiel", "Motifs particuliers"]);
    assert.match(lines[0].text, /1 jour/);
    assert.match(policyLines({ ...input, freeCancellationHours: 36 })[0].text, /36 heures/);
    assert.ok(policyCheckoutMessage({ ...input, customerText: "x".repeat(3000) }).length <= 1200);
    assert.match(policyLines({ ...input, freeCancellationHours: 48 })[0].text, /2 jours/);
  });
});

describe("limiteur de débit des endpoints publics", () => {
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

  it("bloque après le quota par IP puis renvoie 429 avec Retry-After", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, key: "t" });
    let passed = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = mockRes();
      limiter({ ip: "1.2.3.4", header: () => undefined } as never, r as never, () => {
        passed += 1;
      });
      if (i >= 3) {
        assert.equal(r.code, 429);
        assert.ok(r.headers["Retry-After"]);
      }
    }
    assert.equal(passed, 3);
    let other = 0;
    limiter({ ip: "5.6.7.8", header: () => undefined } as never, mockRes() as never, () => {
      other += 1;
    });
    assert.equal(other, 1);
  });
});

