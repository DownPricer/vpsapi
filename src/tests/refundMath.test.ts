import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  derivePaymentRefundState,
  expectedApplicationFeeRefund,
  mapStripeRefundStatus,
  refundableCents,
  sumRefunds,
} from "../services/stripe/refundMath";

describe("expectedApplicationFeeRefund", () => {
  it("rembourse les 5 € de commission pour un remboursement intégral de 100 €", () => {
    assert.equal(
      expectedApplicationFeeRefund({ feeTotalCents: 500, feeRefundedCents: 0, chargeCents: 10_000, alreadyRefundedCents: 0, refundCents: 10_000 }),
      500
    );
  });

  it("rend 2 € de commission pour 40 € remboursés sur 100 €", () => {
    assert.equal(
      expectedApplicationFeeRefund({ feeTotalCents: 500, feeRefundedCents: 0, chargeCents: 10_000, alreadyRefundedCents: 0, refundCents: 4_000 }),
      200
    );
  });

  it("40 € puis 60 € : la commission restituée totalise exactement 5 €", () => {
    const first = expectedApplicationFeeRefund({ feeTotalCents: 500, feeRefundedCents: 0, chargeCents: 10_000, alreadyRefundedCents: 0, refundCents: 4_000 });
    const second = expectedApplicationFeeRefund({ feeTotalCents: 500, feeRefundedCents: first, chargeCents: 10_000, alreadyRefundedCents: 4_000, refundCents: 6_000 });
    assert.equal(first + second, 500);
  });

  it("utilise la commission réelle de la charge, pas la valeur fixe de 5 €", () => {
    assert.equal(
      expectedApplicationFeeRefund({ feeTotalCents: 750, feeRefundedCents: 0, chargeCents: 10_000, alreadyRefundedCents: 0, refundCents: 4_000 }),
      300
    );
    assert.equal(
      expectedApplicationFeeRefund({ feeTotalCents: 0, feeRefundedCents: 0, chargeCents: 10_000, alreadyRefundedCents: 0, refundCents: 4_000 }),
      0
    );
  });

  it("ne dépasse jamais la commission restante", () => {
    assert.equal(
      expectedApplicationFeeRefund({ feeTotalCents: 500, feeRefundedCents: 490, chargeCents: 10_000, alreadyRefundedCents: 9_000, refundCents: 500 }),
      10
    );
  });
});

describe("totaux et statuts", () => {
  it("le solde remboursable déduit confirmés ET en cours", () => {
    const totals = sumRefunds([
      { amount: 3_000, status: "SUCCEEDED" },
      { amount: 2_000, status: "PENDING" },
      { amount: 9_999, status: "FAILED" },
      { amount: 9_999, status: "CANCELED" },
    ]);
    assert.deepEqual(totals, { succeeded: 3_000, inFlight: 2_000 });
    assert.equal(refundableCents(10_000, totals), 5_000);
    assert.equal(refundableCents(1_000, totals), 0);
  });

  it("un remboursement en cours n'est jamais présenté comme terminé", () => {
    assert.equal(
      derivePaymentRefundState({ paidCents: 10_000, totals: { succeeded: 0, inFlight: 10_000 }, latestTerminalFailure: false }),
      "REFUND_PENDING"
    );
  });

  it("partiel / total / échec / aucun", () => {
    const base = { paidCents: 10_000, latestTerminalFailure: false };
    assert.equal(derivePaymentRefundState({ ...base, totals: { succeeded: 4_000, inFlight: 0 } }), "PARTIALLY_REFUNDED");
    assert.equal(derivePaymentRefundState({ ...base, totals: { succeeded: 10_000, inFlight: 0 } }), "REFUNDED");
    assert.equal(derivePaymentRefundState({ ...base, totals: { succeeded: 0, inFlight: 0 }, latestTerminalFailure: true }), "REFUND_FAILED");
    assert.equal(derivePaymentRefundState({ ...base, totals: { succeeded: 0, inFlight: 0 } }), "PAID");
  });

  it("mappe les statuts Stripe", () => {
    assert.equal(mapStripeRefundStatus("succeeded"), "SUCCEEDED");
    assert.equal(mapStripeRefundStatus("failed"), "FAILED");
    assert.equal(mapStripeRefundStatus("canceled"), "CANCELED");
    assert.equal(mapStripeRefundStatus("requires_action"), "REQUIRES_ACTION");
    assert.equal(mapStripeRefundStatus("pending"), "PENDING");
    assert.equal(mapStripeRefundStatus(null), "PENDING");
  });
});
