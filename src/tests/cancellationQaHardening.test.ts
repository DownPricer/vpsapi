import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LeadStatus } from "@prisma/client";
import {
  BookingCancellationError,
  mapRefundFailureToCancellationError,
} from "../services/bookingCancellation.service";
import { RequestService, RequestStatusTransitionError } from "../services/request.service";
import { RefundServiceError } from "../services/stripe/refund.service";

describe("LOT3 — PATCH /status refuse les annulations", () => {
  const svc = new RequestService();

  for (const status of [LeadStatus.cancelled, LeadStatus.cancellation_requested] as const) {
    it(`refuse nextStatus=${status} avant tout accès base (STATUS_VIA_CANCEL_FLOW)`, async () => {
      await assert.rejects(
        () =>
          svc.updateStatus({
            tenantId: "tenant-qa",
            leadId: "lead-qa",
            nextStatus: status,
            changedByUserId: "user-qa",
          }),
        (e: unknown) =>
          e instanceof RequestStatusTransitionError &&
          e.code === "STATUS_VIA_CANCEL_FLOW" &&
          e.httpStatus === 400 &&
          /POST .*\/cancel/i.test(e.message)
      );
    });
  }
});

describe("LOT3 — STRIPE_UNCERTAIN n'annule pas (mapRefundFailureToCancellationError)", () => {
  it("convertit STRIPE_UNCERTAIN en REFUND_UNCERTAIN (502) avec consigne clientRequestId", () => {
    const src = new RefundServiceError("STRIPE_UNCERTAIN", "réseau", 502, { refundId: "rf_1" });
    assert.throws(
      () => mapRefundFailureToCancellationError(src),
      (e: unknown) =>
        e instanceof BookingCancellationError &&
        e.code === "REFUND_UNCERTAIN" &&
        e.httpStatus === 502 &&
        /clientRequestId/i.test(e.message)
    );
  });

  it("laisse passer STRIPE_REFUND_REJECTED sans conversion (comme avant)", () => {
    const src = new RefundServiceError("STRIPE_REFUND_REJECTED", "refusé", 402);
    assert.throws(
      () => mapRefundFailureToCancellationError(src),
      (e: unknown) => e instanceof RefundServiceError && e.code === "STRIPE_REFUND_REJECTED"
    );
  });

  it("propage les erreurs inconnues telles quelles", () => {
    const src = new Error("boom");
    assert.throws(() => mapRefundFailureToCancellationError(src), (e: unknown) => e === src);
  });
});
