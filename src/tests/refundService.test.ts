import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LeadPaymentStatus, PaymentStatus, RefundInitiator, RefundStatus } from "@prisma/client";
import { RefundServiceError } from "../services/stripe/refund.service";
import { OTHER_TENANT, PI, TENANT, makeEnv } from "./helpers/refundFakes";

const base = { tenantId: TENANT, paymentId: "pay_1", reason: "driver_cancelled" as const };

async function expectError(p: Promise<unknown>, code: string): Promise<RefundServiceError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof RefundServiceError, `RefundServiceError attendue, reçu ${String(e)}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`erreur ${code} attendue`);
}

describe("remboursement intégral (paiement test 100 €, commission 5 €)", () => {
  it("rembourse 100 € et restitue 5 € de commission via refund_application_fee", async () => {
    const { service, store, gateway, notifier } = makeEnv();
    const res = await service.requestRefund({ ...base, full: true, clientRequestId: "req-full-0001" });

    assert.equal(res.confirmed, true);
    assert.equal(res.refund.amount, 10_000);
    assert.equal(res.refund.status, RefundStatus.SUCCEEDED);
    assert.equal(res.refund.applicationFeeRefundExpected, 500);

    const pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.REFUNDED);
    assert.equal(pay.refundedAmount, 10_000);
    assert.equal(pay.applicationFeeRefundedAmount, 500);
    assert.equal(store.leadPaymentStatus.get("lead_1"), LeadPaymentStatus.REFUNDED);
    assert.equal(store.refunds.get(res.refund.id)!.applicationFeeRefunded, 500);
    assert.equal(gateway.createCalls, 1);
    assert.deepEqual(notifier.kinds(), ["succeeded"]);
    assert.equal(notifier.sent[0].fullyRefunded, true);
  });
});

describe("remboursement partiel (40 € sur 100 €)", () => {
  it("rend 2 € de commission, statut partiellement remboursé, solde 60 €", async () => {
    const { service, store, notifier } = makeEnv();
    const res = await service.requestRefund({ ...base, amountCents: 4_000, clientRequestId: "req-part-0001" });

    assert.equal(res.refund.amount, 4_000);
    assert.equal(res.refund.applicationFeeRefundExpected, 200);
    const pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.PARTIALLY_REFUNDED);
    assert.equal(pay.applicationFeeRefundedAmount, 200);
    assert.equal(store.leadPaymentStatus.get("lead_1"), LeadPaymentStatus.PARTIALLY_REFUNDED);
    assert.equal(notifier.sent[0].fullyRefunded, false);

    const preview = await service.preview({ tenantId: TENANT, paymentId: "pay_1" });
    assert.equal(preview.refundableCents, 6_000);
    assert.equal(preview.refundedCents, 4_000);
    // solde : 60 € remboursables → le reste de la commission (3 €) est restitué avec ce remboursement
    assert.equal(preview.platformFeeRefundCents, 300);
    assert.equal(preview.driverNetDebitCents, 5_700);
  });

  it("plusieurs remboursements partiels dans la limite du montant payé (40 € puis 60 €)", async () => {
    const { service, store } = makeEnv();
    await service.requestRefund({ ...base, amountCents: 4_000, clientRequestId: "req-part-0001" });
    await service.requestRefund({ ...base, amountCents: 6_000, clientRequestId: "req-part-0002" });
    const pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.REFUNDED);
    assert.equal(pay.refundedAmount, 10_000);
    assert.equal(pay.applicationFeeRefundedAmount, 500);
  });

  it("refuse un remboursement supplémentaire au-delà du montant payé", async () => {
    const { service, gateway } = makeEnv();
    await service.requestRefund({ ...base, amountCents: 7_000, clientRequestId: "req-over-0001" });
    const err = await expectError(
      service.requestRefund({ ...base, amountCents: 4_000, clientRequestId: "req-over-0002" }),
      "AMOUNT_EXCEEDS_REFUNDABLE"
    );
    assert.equal((err.details as { refundableCents: number }).refundableCents, 3_000);
    assert.equal(gateway.createCalls, 1);
  });
});

describe("protection contre les doubles remboursements", () => {
  it("double clic (même clientRequestId en parallèle) : un seul remboursement Stripe", async () => {
    const { service, store, gateway } = makeEnv();
    const input = { ...base, amountCents: 4_000, clientRequestId: "req-dbl-0001" };
    const [a, b] = await Promise.allSettled([service.requestRefund(input), service.requestRefund(input)]);
    assert.equal(a.status, "fulfilled");
    assert.equal(b.status, "fulfilled");
    assert.equal(store.refunds.size, 1);
    assert.equal(gateway.refunds.length, 1);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 4_000);
    if (a.status === "fulfilled" && b.status === "fulfilled") assert.equal(a.value.refund.id, b.value.refund.id);
  });

  it("deux demandes simultanées de 100 € avec des identifiants différents : une seule passe", async () => {
    const { service, gateway } = makeEnv();
    const results = await Promise.allSettled([
      service.requestRefund({ ...base, full: true, clientRequestId: "req-conc-0001" }),
      service.requestRefund({ ...base, full: true, clientRequestId: "req-conc-0002" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(gateway.refunds.length, 1);
    assert.equal(gateway.charges.get(PI)!.amountRefunded, 10_000);
  });

  it("erreur réseau avant Stripe : le nouvel essai réutilise la même clé et crée UN remboursement", async () => {
    const { service, store, gateway } = makeEnv();
    gateway.nextCreateFailure = "network";
    const input = { ...base, amountCents: 4_000, clientRequestId: "req-net-0001" };

    const err = await expectError(service.requestRefund(input), "STRIPE_UNCERTAIN");
    assert.ok(err.details?.refundId);
    const pending = [...store.refunds.values()][0];
    assert.equal(pending.status, RefundStatus.PENDING);
    assert.equal(pending.stripeRefundId, null);
    // l'état n'est pas « remboursé » : il est « en cours »
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.REFUND_PENDING);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 0);

    const keyBefore = pending.idempotencyKey;
    const retry = await service.requestRefund(input);
    assert.equal(store.refunds.size, 1);
    assert.equal(retry.refund.idempotencyKey, keyBefore);
    assert.equal(gateway.refunds.length, 1);
    assert.equal(retry.confirmed, true);
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.PARTIALLY_REFUNDED);
  });

  it("réponse Stripe perdue APRÈS création : le nouvel essai retrouve le remboursement sans en créer un second", async () => {
    const { service, store, gateway } = makeEnv();
    gateway.nextCreateFailure = "lost";
    const input = { ...base, amountCents: 4_000, clientRequestId: "req-lost-0001" };

    await expectError(service.requestRefund(input), "STRIPE_UNCERTAIN");
    assert.equal(gateway.refunds.length, 1); // Stripe l'a bien créé
    const retry = await service.requestRefund(input);

    assert.equal(gateway.refunds.length, 1);
    assert.equal(gateway.charges.get(PI)!.amountRefunded, 4_000);
    assert.equal(store.refunds.size, 1);
    assert.equal(retry.refund.stripeRefundId, gateway.refunds[0].id);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 4_000);
  });
});

describe("remboursement en attente chez Stripe", () => {
  it("n'est pas annoncé comme terminé avant confirmation, puis se finalise via la synchro", async () => {
    const { service, store, gateway, notifier } = makeEnv();
    gateway.newRefundStatus = "pending";
    const res = await service.requestRefund({ ...base, full: true, clientRequestId: "req-pend-0001" });

    assert.equal(res.confirmed, false);
    assert.equal(res.refund.status, RefundStatus.PENDING);
    let pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.REFUND_PENDING);
    assert.equal(pay.refundedAmount, 0);
    assert.deepEqual(notifier.kinds(), ["initiated"]);

    // un second remboursement est refusé tant que le premier n'est pas confirmé
    await expectError(
      service.requestRefund({ ...base, amountCents: 100, clientRequestId: "req-pend-0002" }),
      "PAYMENT_NOT_REFUNDABLE"
    );

    gateway.setRefundStatus(gateway.refunds[0].id, "succeeded");
    await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });
    pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.REFUNDED);
    assert.equal(pay.refundedAmount, 10_000);
    assert.deepEqual(notifier.kinds(), ["initiated", "succeeded"]);
  });

  it("un remboursement qui échoue passe le paiement en « remboursement échoué » et reste ré-essayable", async () => {
    const { service, store, gateway, notifier } = makeEnv();
    gateway.newRefundStatus = "pending";
    await service.requestRefund({ ...base, full: true, clientRequestId: "req-fail-0001" });
    gateway.setRefundStatus(gateway.refunds[0].id, "failed", "insufficient_funds");
    await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });

    const pay = store.payments.get("pay_1")!;
    assert.equal(pay.status, PaymentStatus.REFUND_FAILED);
    assert.equal(pay.refundedAmount, 0);
    assert.equal(store.leadPaymentStatus.get("lead_1"), LeadPaymentStatus.REFUND_FAILED);
    assert.ok(notifier.kinds().includes("failed"));

    gateway.newRefundStatus = "succeeded";
    const retry = await service.requestRefund({ ...base, full: true, clientRequestId: "req-fail-0002" });
    assert.equal(retry.confirmed, true);
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.REFUNDED);
  });

  it("refus définitif de Stripe : ligne en échec, e-mail d'échec, erreur claire, aucun remboursement", async () => {
    const { service, store, gateway, notifier } = makeEnv();
    gateway.nextCreateFailure = "reject";
    const err = await expectError(
      service.requestRefund({ ...base, full: true, clientRequestId: "req-rej-0001" }),
      "STRIPE_REFUND_REJECTED"
    );
    assert.match(err.message, /solde/i);
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.REFUND_FAILED);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 0);
    assert.deepEqual(notifier.kinds(), ["failed"]);
    assert.equal(gateway.refunds.length, 0);
  });
});

describe("webhooks : doublons et ordre", () => {
  it("événement dupliqué : état identique et une seule notification", async () => {
    const { service, store, gateway, notifier } = makeEnv();
    await service.requestRefund({ ...base, amountCents: 4_000, clientRequestId: "req-dup-0001" });
    for (let i = 0; i < 3; i += 1) await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });

    assert.equal(store.refunds.size, 1);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 4_000);
    assert.equal(gateway.refunds.length, 1);
    assert.deepEqual(notifier.kinds(), ["succeeded"]);
  });

  it("événements reçus dans le désordre : un instantané « pending » tardif ne fait pas régresser un remboursement confirmé", async () => {
    const { service, store, gateway } = makeEnv();
    gateway.newRefundStatus = "pending";
    // Pendant l'appel Stripe, le webhook « succeeded » est déjà traité (arrive avant la réponse HTTP).
    gateway.afterCreate = async (r) => {
      gateway.setRefundStatus(r.id, "succeeded");
      await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });
    };
    const res = await service.requestRefund({ ...base, full: true, clientRequestId: "req-ord-0001" });

    const row = store.refunds.get(res.refund.id)!;
    assert.equal(row.status, RefundStatus.SUCCEEDED); // pas de retour à PENDING
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.REFUNDED);
  });

  it("événement pour un autre compte / paiement inconnu : ignoré", async () => {
    const { service, store } = makeEnv();
    assert.equal(await service.reconcileByPaymentIntent({ accountId: "acct_OTHER", paymentIntentId: PI }), false);
    assert.equal(await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: "pi_unknown" }), false);
    assert.equal(store.refunds.size, 0);
  });

  it("remboursement fait depuis le dashboard Stripe : rattaché au bon paiement/tenant, initiateur STRIPE_DASHBOARD", async () => {
    const { service, store, gateway } = makeEnv();
    gateway.addDashboardRefund(PI, 2_500);
    await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });
    await service.reconcileByPaymentIntent({ accountId: "acct_A", paymentIntentId: PI });

    assert.equal(store.refunds.size, 1);
    const row = [...store.refunds.values()][0];
    assert.equal(row.initiatedBy, RefundInitiator.STRIPE_DASHBOARD);
    assert.equal(row.tenantId, TENANT);
    assert.equal(store.payments.get("pay_1")!.refundedAmount, 2_500);
    assert.equal(store.payments.get("pay_1")!.status, PaymentStatus.PARTIALLY_REFUNDED);
  });

  it("le solde tient compte d'un remboursement dashboard avant d'en créer un nouveau", async () => {
    const { service, gateway } = makeEnv();
    gateway.addDashboardRefund(PI, 9_000);
    await expectError(
      service.requestRefund({ ...base, amountCents: 2_000, clientRequestId: "req-dash-0001" }),
      "AMOUNT_EXCEEDS_REFUNDABLE"
    );
    assert.equal(gateway.createCalls, 0);
  });
});

describe("isolation et garde-fous", () => {
  it("paiement d'un autre tenant : introuvable, aucun appel Stripe", async () => {
    const { service, gateway } = makeEnv();
    await expectError(
      service.requestRefund({ ...base, tenantId: OTHER_TENANT, full: true, clientRequestId: "req-ten-0001" }),
      "PAYMENT_NOT_FOUND"
    );
    await expectError(service.preview({ tenantId: OTHER_TENANT, paymentId: "pay_1" }), "PAYMENT_NOT_FOUND");
    assert.equal(gateway.createCalls, 0);
  });

  it("compte Stripe du paiement ≠ compte actuel du tenant : refusé", async () => {
    const { service, store, gateway } = makeEnv();
    store.payments.get("pay_1")!.tenantStripeAccountId = "acct_CHANGED";
    await expectError(
      service.requestRefund({ ...base, full: true, clientRequestId: "req-acc-0001" }),
      "STRIPE_ACCOUNT_MISMATCH"
    );
    assert.equal(gateway.createCalls, 0);
  });

  it("charge qui n'est pas une direct charge du compte connecté : refus explicite (pas de reverse_transfer)", async () => {
    const { service, gateway } = makeEnv();
    gateway.charges.get(PI)!.direct = false;
    await expectError(
      service.requestRefund({ ...base, full: true, clientRequestId: "req-dir-0001" }),
      "UNSUPPORTED_CHARGE_TYPE"
    );
    assert.equal(gateway.createCalls, 0);
  });

  it("paiement non encaissé : remboursement impossible", async () => {
    const { service, store } = makeEnv();
    store.payments.get("pay_1")!.status = PaymentStatus.LINK_SENT;
    await expectError(
      service.requestRefund({ ...base, full: true, clientRequestId: "req-unp-0001" }),
      "PAYMENT_NOT_REFUNDABLE"
    );
  });

  it("montant invalide (0, négatif, décimal tronqué) refusé ; clientRequestId trop court refusé", async () => {
    const { service } = makeEnv();
    await expectError(service.requestRefund({ ...base, amountCents: 0, clientRequestId: "req-inv-0001" }), "VALIDATION_ERROR");
    await expectError(service.requestRefund({ ...base, amountCents: -5, clientRequestId: "req-inv-0002" }), "VALIDATION_ERROR");
    await expectError(service.requestRefund({ ...base, amountCents: 100, clientRequestId: "x" }), "VALIDATION_ERROR");
  });

  it("commission réelle différente de 5 € : lue sur Stripe, jamais forcée à 500 centimes", async () => {
    const { service, store } = makeEnv({ amount: 10_000, fee: 750 });
    store.payments.get("pay_1")!.applicationFeeAmount = 500; // valeur locale obsolète
    const res = await service.requestRefund({ ...base, amountCents: 4_000, clientRequestId: "req-fee-0001" });
    assert.equal(res.refund.applicationFeeRefundExpected, 300);
    assert.equal(store.payments.get("pay_1")!.applicationFeeRefundedAmount, 300);
  });
});
