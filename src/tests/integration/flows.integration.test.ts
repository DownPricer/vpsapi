/**
 * Tests d'intégration sur une base PostgreSQL JETABLE (jamais la production).
 * Lancer avec : TEST_DATABASE_URL=postgresql://… (la base doit avoir toutes les migrations appliquées).
 * Sans cette variable, la suite est ignorée.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_used_for_network";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_integration";
}

const suite = TEST_DB ? describe : describe.skip;

suite("intégration (PostgreSQL jetable)", () => {
  // Imports dynamiques : DATABASE_URL doit être positionnée avant l'instanciation de Prisma.
  let prisma: typeof import("../../db/prisma").prisma;
  let refundSvc: typeof import("../../services/stripe/refund.service");
  let helpers: typeof import("../helpers/refundFakes");
  let storeMod: typeof import("../../services/stripe/prismaRefundStore");
  let cancelSvc: typeof import("../../services/bookingCancellation.service");
  let containerMod: typeof import("../../services/refundContainer");
  let access: typeof import("../../services/bookingAccess.service");
  let webhookSvc: typeof import("../../services/stripeWebhook.service");
  let webhookCtl: typeof import("../../controllers/stripeWebhook.controller");
  let registry: typeof import("../../config/tenants/registry");
  let client: typeof import("@prisma/client");

  const T1 = "itest_a";
  const T2 = "itest_b";
  const ACCT1 = "acct_itest_a";
  const ACCT2 = "acct_itest_b";
  let seq = 0;

  before(async () => {
    prisma = (await import("../../db/prisma")).prisma;
    refundSvc = await import("../../services/stripe/refund.service");
    helpers = await import("../helpers/refundFakes");
    storeMod = await import("../../services/stripe/prismaRefundStore");
    cancelSvc = await import("../../services/bookingCancellation.service");
    containerMod = await import("../../services/refundContainer");
    access = await import("../../services/bookingAccess.service");
    webhookSvc = await import("../../services/stripeWebhook.service");
    webhookCtl = await import("../../controllers/stripeWebhook.controller");
    registry = await import("../../config/tenants/registry");
    client = await import("@prisma/client");

    await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
    await prisma.tenant.create({
      data: { id: T1, name: "Tenant A", slug: "itest-a", stripeAccountId: ACCT1, stripeChargesEnabled: true },
    });
    await prisma.tenant.create({
      data: { id: T2, name: "Tenant B", slug: "itest-b", stripeAccountId: ACCT2, stripeChargesEnabled: true },
    });
  });

  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
    await prisma.$disconnect();
  });

  async function seedLead(tenantId: string, status: import("@prisma/client").LeadStatus = "accepted", extra: object = {}) {
    seq += 1;
    return prisma.leadRequest.create({
      data: {
        tenantId,
        kind: "reservation",
        status,
        clientName: "Client Test",
        clientPhone: "0600000000",
        clientEmail: "client@example.test",
        rawPayload: {},
        flatPayload: { ResumeTrajet: "Rouen → Paris" },
        pricingResult: { tarif: 100 },
        scheduledStart: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        ...extra,
      },
    });
  }

  async function seedPayment(tenantId: string, leadId: string, opts: { status?: import("@prisma/client").PaymentStatus; amount?: number; fee?: number; acct?: string } = {}) {
    seq += 1;
    return prisma.payment.create({
      data: {
        tenantId,
        leadRequestId: leadId,
        status: opts.status ?? "PAID",
        mode: "FULL",
        amount: opts.amount ?? 10_000,
        currency: "eur",
        applicationFeeAmount: opts.fee ?? 500,
        stripeAccountId: opts.acct ?? (tenantId === T1 ? ACCT1 : ACCT2),
        stripePaymentIntentId: `pi_it_${Date.now()}_${seq}`,
        stripeCheckoutSessionId: `cs_it_${Date.now()}_${seq}`,
        paidAt: opts.status === "LINK_SENT" ? null : new Date(),
      },
    });
  }

  function install(gateway: import("../helpers/refundFakes").FakeGateway) {
    const notifier = new helpers.FakeNotifier();
    const service = new refundSvc.RefundService({
      store: new storeMod.PrismaRefundStore(),
      gateway: () => gateway,
      notifier,
    });
    containerMod.setRefundServiceForTests(service);
    return { service, notifier };
  }

  const tenantCfg = () => registry.getTenantConfig("default")!;

  it("migration : les anciennes lignes restent intactes et les nouveaux champs ont des valeurs par défaut", async () => {
    const lead = await seedLead(T1);
    const pay = await seedPayment(T1, lead.id);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
    assert.equal(row.refundedAmount, 0);
    assert.equal(row.applicationFeeRefundedAmount, 0);
    assert.equal(row.stripeChargeId, null);
    assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: lead.id } })).cancellationPolicySnapshot, null);
  });

  describe("remboursement avec verrou PostgreSQL", () => {
    it("remboursement intégral 100 € (commission 5 €) enregistré en base, statuts paiement + réservation", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service, notifier } = install(gw);

      const res = await service.requestRefund({ tenantId: T1, paymentId: pay.id, full: true, reason: "driver_cancelled", clientRequestId: "it-full-000001" });
      assert.equal(res.confirmed, true);
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.status, "REFUNDED");
      assert.equal(p.refundedAmount, 10_000);
      assert.equal(p.applicationFeeRefundedAmount, 500);
      assert.equal(p.stripeChargeId, `ch_${pay.stripePaymentIntentId}`);
      assert.ok(p.refundedAt);
      assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: lead.id } })).paymentStatus, "REFUNDED");
      const rf = await prisma.paymentRefund.findMany({ where: { paymentId: pay.id } });
      assert.equal(rf.length, 1);
      assert.equal(rf[0].applicationFeeRefunded, 500);
      assert.equal(rf[0].status, "SUCCEEDED");
      assert.deepEqual(notifier.kinds(), ["succeeded"]);
    });

    it("partiel 40 € → commission 2 € ; puis 60 € → total 5 €", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      await service.requestRefund({ tenantId: T1, paymentId: pay.id, amountCents: 4_000, reason: "goodwill", clientRequestId: "it-part-000001" });
      let p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.status, "PARTIALLY_REFUNDED");
      assert.equal(p.applicationFeeRefundedAmount, 200);
      await service.requestRefund({ tenantId: T1, paymentId: pay.id, amountCents: 6_000, reason: "goodwill", clientRequestId: "it-part-000002" });
      p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.status, "REFUNDED");
      assert.equal(p.applicationFeeRefundedAmount, 500);
    });

    it("double clic simultané (même clientRequestId) : une seule ligne, un seul appel Stripe", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      const input = { tenantId: T1, paymentId: pay.id, amountCents: 4_000, reason: "goodwill", clientRequestId: "it-dbl-0000001" };
      const results = await Promise.allSettled([service.requestRefund(input), service.requestRefund(input), service.requestRefund(input)]);
      assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => r.status)));
      assert.equal(await prisma.paymentRefund.count({ where: { paymentId: pay.id } }), 1);
      assert.equal(gw.refunds.length, 1);
    });

    it("deux demandes simultanées de 100 € (identifiants différents) : une seule réussit (FOR UPDATE)", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      const results = await Promise.allSettled(
        [1, 2, 3, 4].map((i) =>
          service.requestRefund({ tenantId: T1, paymentId: pay.id, full: true, reason: "goodwill", clientRequestId: `it-conc-00000${i}` })
        )
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(gw.refunds.length, 1);
      assert.equal(await prisma.paymentRefund.count({ where: { paymentId: pay.id } }), 1);
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.refundedAmount, 10_000);
    });

    it("paiement d'un autre tenant : refusé, rien en base", async () => {
      const lead = await seedLead(T2);
      const pay = await seedPayment(T2, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT2, 10_000, 500);
      const { service } = install(gw);
      await assert.rejects(
        service.requestRefund({ tenantId: T1, paymentId: pay.id, full: true, reason: "goodwill", clientRequestId: "it-xten-000001" }),
        (e: unknown) => e instanceof refundSvc.RefundServiceError && e.code === "PAYMENT_NOT_FOUND"
      );
      assert.equal(gw.createCalls, 0);
      assert.equal(await prisma.paymentRefund.count({ where: { paymentId: pay.id } }), 0);
    });
  });

  describe("webhooks (traitement réel + idempotence par event.id)", () => {
    it("account.updated met à jour le bon tenant (via event.account)", async () => {
      await webhookSvc.processStripeWebhookEvent({
        id: "evt_acc_1",
        type: "account.updated",
        account: ACCT1,
        data: { object: { id: ACCT1, details_submitted: true, charges_enabled: true, payouts_enabled: false, requirements: { currently_due: [], past_due: [], pending_verification: [], disabled_reason: null } } },
      });
      const t1 = await prisma.tenant.findUniqueOrThrow({ where: { id: T1 } });
      const t2 = await prisma.tenant.findUniqueOrThrow({ where: { id: T2 } });
      assert.equal(t1.stripePayoutsEnabled, false);
      assert.equal(t1.stripeDetailsSubmitted, true);
      assert.equal(t1.stripeOnboardingStatus, "COMPLETE");
      assert.equal(t2.stripeDetailsSubmitted, false); // l'autre tenant n'est pas touché
    });

    it("refund.updated : synchronise un remboursement en attente, ordre et doublons sans effet", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.newRefundStatus = "pending";
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service, notifier } = install(gw);
      await service.requestRefund({ tenantId: T1, paymentId: pay.id, full: true, reason: "goodwill", clientRequestId: "it-wh-0000001" });
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "REFUND_PENDING");

      gw.setRefundStatus(gw.refunds[0].id, "succeeded");
      const evt = { type: "refund.updated", account: ACCT1, data: { object: { id: gw.refunds[0].id, payment_intent: pay.stripePaymentIntentId } } };
      await webhookSvc.processStripeWebhookEvent({ id: "evt_r_2", ...evt });
      await webhookSvc.processStripeWebhookEvent({ id: "evt_r_1", type: "refund.created", account: ACCT1, data: evt.data });
      await webhookSvc.processStripeWebhookEvent({ id: "evt_r_2", ...evt });

      const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.status, "REFUNDED");
      assert.equal(p.refundedAmount, 10_000);
      assert.equal(await prisma.paymentRefund.count({ where: { paymentId: pay.id } }), 1);
      assert.deepEqual(notifier.kinds(), ["initiated", "succeeded"]);
    });

    it("contrôleur : signature vérifiée, événement dupliqué traité une seule fois", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      gw.addDashboardRefund(pay.stripePaymentIntentId!, 1_500);
      const { notifier } = install(gw);

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe("sk_test_dummy");
      const eventId = `evt_ctl_${Date.now()}`;
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        type: "charge.refunded",
        account: ACCT1,
        data: { object: { id: "ch_x", object: "charge", payment_intent: pay.stripePaymentIntentId } },
      });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_integration" });

      const call = async (sig: string) => {
        const out = { code: 0, body: undefined as unknown };
        const res = { status(c: number) { out.code = c; return this; }, json(b: unknown) { out.body = b; return this; } };
        await webhookCtl.postStripeWebhook(
          { headers: { "stripe-signature": sig }, body: Buffer.from(payload), ip: "127.0.0.1" } as never,
          res as never,
          (e?: unknown) => { throw e; }
        );
        return out;
      };

      const bad = await call("t=1,v1=deadbeef");
      assert.equal(bad.code, 400);
      assert.equal(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: eventId } }), 0);

      const first = await call(header);
      const second = await call(header);
      assert.equal(first.code, 200);
      assert.equal(second.code, 200);
      assert.equal(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: eventId } }), 1);
      assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: eventId } })).stripeAccountId, ACCT1);
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.equal(p.refundedAmount, 1_500);
      assert.equal(p.status, "PARTIALLY_REFUNDED");
      assert.equal(notifier.kinds().filter((k) => k === "succeeded").length, 1);
    });
  });

  describe("annulation par le chauffeur", () => {
    const base = (leadId: string, over: object = {}) => ({
      tenant: tenantCfg(),
      tenantId: T1,
      leadId,
      actorUserId: null,
      reason: "Véhicule indisponible",
      refund: { mode: "none" as const },
      refundConfirmed: false,
      clientRequestId: `it-cancel-${leadId.slice(-8)}`,
      notifyCustomer: false,
      ...over,
    });

    it("réservation non payée : annulée, lien de paiement annulé, aucun remboursement tenté", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id, { status: "LINK_SENT" });
      const gw = new helpers.FakeGateway();
      install(gw);
      const out = await cancelSvc.cancelBooking(base(lead.id));
      assert.equal(out.lead.status, "cancelled");
      assert.equal(out.unpaidPaymentsCancelled, 1);
      assert.equal(out.refund, null);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "CANCELLED");
      assert.equal(gw.createCalls, 0);
      const hist = await prisma.leadStatusHistory.findMany({ where: { leadId: lead.id } });
      assert.ok(hist.some((h) => h.newStatus === "cancelled"));
    });

    it("annulée ≠ remboursée : sans remboursement, le paiement reste PAID", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      install(gw);
      await cancelSvc.cancelBooking(base(lead.id));
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "PAID");
      assert.equal(gw.createCalls, 0);
    });

    it("remboursement intégral exige une confirmation explicite : sans elle rien n'est annulé", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      install(gw);
      await assert.rejects(
        cancelSvc.cancelBooking(base(lead.id, { refund: { mode: "full" }, refundConfirmed: false })),
        (e: unknown) => e instanceof cancelSvc.BookingCancellationError && e.code === "REFUND_CONFIRMATION_REQUIRED"
      );
      assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: lead.id } })).status, "accepted");
      assert.equal(gw.createCalls, 0);

      const ok = await cancelSvc.cancelBooking(base(lead.id, { refund: { mode: "full" }, refundConfirmed: true }));
      assert.equal(ok.lead.status, "cancelled");
      assert.equal(ok.refund?.confirmed, true);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "REFUNDED");
      // rejouer la même demande ne rembourse pas deux fois
      await assert.rejects(cancelSvc.cancelBooking(base(lead.id, { refund: { mode: "full" }, refundConfirmed: true })), (e: unknown) => e instanceof cancelSvc.BookingCancellationError && e.code === "ALREADY_CANCELLED");
      assert.equal(gw.refunds.length, 1);
    });

    it("annulation avec remboursement partiel", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      install(gw);
      const out = await cancelSvc.cancelBooking(base(lead.id, { refund: { mode: "partial", amountCents: 4_000 }, refundConfirmed: true }));
      assert.equal(out.refund?.refund.amount, 4_000);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "PARTIALLY_REFUNDED");
    });

    it("remboursement refusé par Stripe : la réservation n'est PAS annulée (le chauffeur peut corriger)", async () => {
      const lead = await seedLead(T1);
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      gw.nextCreateFailure = "reject";
      install(gw);
      await assert.rejects(
        cancelSvc.cancelBooking(base(lead.id, { refund: { mode: "full" }, refundConfirmed: true })),
        (e: unknown) => e instanceof refundSvc.RefundServiceError && e.code === "STRIPE_REFUND_REJECTED"
      );
      assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: lead.id } })).status, "accepted");
    });

    it("demande d'un autre tenant : introuvable", async () => {
      const lead = await seedLead(T2);
      install(new helpers.FakeGateway());
      await assert.rejects(cancelSvc.cancelBooking(base(lead.id)), (e: unknown) => e instanceof cancelSvc.BookingCancellationError && e.code === "NOT_FOUND");
    });
  });

  describe("annulation demandée par le client (jeton sécurisé)", () => {
    it("parcours complet : lien → consultation → demande → traitement chauffeur", async () => {
      const lead = await seedLead(T1, "accepted", {
        cancellationPolicySnapshot: { policy: { freeCancellationHours: 24, partialRefundConditions: "", lateCancellationConditions: "", specialReasons: "", customerText: "Texte", version: 3, updatedAt: "2026-01-01T00:00:00.000Z" }, capturedAt: "2026-01-02T00:00:00.000Z", source: "reservation" },
      });
      const pay = await seedPayment(T1, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      install(gw);

      const token = await access.issueBookingAccessToken(lead);
      const view = await cancelSvc.getCustomerBookingView(tenantCfg(), T1, token);
      assert.equal(view.status, "accepted");
      assert.equal(view.canRequestCancellation, true);
      assert.equal(view.policy?.version, 3); // conditions d'origine de la réservation
      assert.equal(view.payment?.paidCents, 10_000);

      const req = await cancelSvc.createCustomerCancellationRequest(tenantCfg(), T1, token, "Changement de programme");
      assert.equal(req.status, "PENDING");
      assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: lead.id } })).status, "cancellation_requested");
      // aucun remboursement automatique côté client
      assert.equal(gw.createCalls, 0);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "PAID");

      await assert.rejects(
        cancelSvc.createCustomerCancellationRequest(tenantCfg(), T1, token, "Encore une demande"),
        (e: unknown) => e instanceof cancelSvc.BookingCancellationError && e.code === "ALREADY_REQUESTED"
      );

      const out = await cancelSvc.resolveCancellationRequest({
        tenant: tenantCfg(), tenantId: T1, leadId: lead.id, actorUserId: null, decision: "accept",
        refund: { mode: "partial", amountCents: 5_000 }, refundConfirmed: true, clientRequestId: "it-resolve-0001", notifyCustomer: false,
      });
      assert.equal(out.lead.status, "cancelled");
      assert.equal(out.result?.refund?.refund.amount, 5_000);
      const cr = await prisma.cancellationRequest.findFirstOrThrow({ where: { leadRequestId: lead.id } });
      assert.equal(cr.status, "ACCEPTED");
    });

    it("refus : la réservation retrouve son statut précédent ; traitement manuel idem", async () => {
      for (const decision of ["refuse", "manual"] as const) {
        const lead = await seedLead(T1, "scheduled");
        install(new helpers.FakeGateway());
        const token = await access.issueBookingAccessToken(lead);
        await cancelSvc.createCustomerCancellationRequest(tenantCfg(), T1, token, "Motif de test");
        const out = await cancelSvc.resolveCancellationRequest({
          tenant: tenantCfg(), tenantId: T1, leadId: lead.id, actorUserId: null, decision,
          refund: { mode: "none" }, refundConfirmed: false, clientRequestId: "it-resolve-0002", notifyCustomer: false,
        });
        assert.equal(out.lead.status, "scheduled");
        const cr = await prisma.cancellationRequest.findFirstOrThrow({ where: { leadRequestId: lead.id } });
        assert.equal(cr.status, decision === "refuse" ? "REFUSED" : "MANUAL");
      }
    });

    it("jeton : invalide, identifiant de réservation, autre tenant, expiré ou révoqué → refusé", async () => {
      const lead = await seedLead(T1);
      const token = await access.issueBookingAccessToken(lead);
      const reject = async (tenantId: string, t: unknown, code: string) =>
        assert.rejects(cancelSvc.getCustomerBookingView(tenantCfg(), tenantId, t), (e: unknown) => e instanceof cancelSvc.BookingCancellationError && e.code === code);

      await reject(T1, lead.id, "LINK_INVALID"); // l'ID de la réservation ne donne jamais accès
      await reject(T1, "a".repeat(43), "LINK_INVALID");
      await reject(T2, token, "LINK_INVALID"); // jeton d'un autre tenant
      await prisma.bookingAccessToken.updateMany({ where: { leadRequestId: lead.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await reject(T1, token, "LINK_EXPIRED");
      await prisma.bookingAccessToken.updateMany({ where: { leadRequestId: lead.id }, data: { expiresAt: new Date(Date.now() + 1e9), revokedAt: new Date() } });
      await reject(T1, token, "LINK_INVALID");
      const stored = await prisma.bookingAccessToken.findFirstOrThrow({ where: { leadRequestId: lead.id } });
      assert.notEqual(stored.tokenHash, token); // seul le hash est stocké
    });

    it("réservation sans politique enregistrée : aucune condition inventée (gestion manuelle)", async () => {
      const lead = await seedLead(T1);
      const token = await access.issueBookingAccessToken(lead);
      const view = await cancelSvc.getCustomerBookingView(tenantCfg(), T1, token);
      assert.equal(view.policy, null);
    });

    it("deux demandes simultanées : une seule demande créée", async () => {
      const lead = await seedLead(T1);
      const token = await access.issueBookingAccessToken(lead);
      const r = await Promise.allSettled([
        cancelSvc.createCustomerCancellationRequest(tenantCfg(), T1, token, "Motif A"),
        cancelSvc.createCustomerCancellationRequest(tenantCfg(), T1, token, "Motif B"),
      ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(await prisma.cancellationRequest.count({ where: { leadRequestId: lead.id } }), 1);
    });
  });

  it("instantané de politique : figé à la création de la demande, insensible aux changements ultérieurs", async () => {
    const { RequestService } = await import("../../services/request.service");
    const { nextPolicy, cancellationPolicyInputSchema } = await import("../../services/cancellationPolicy");
    const v1 = nextPolicy(cancellationPolicyInputSchema.parse({ freeCancellationHours: 24, customerText: "V1" }), null);
    await prisma.tenant.update({ where: { id: T1 }, data: { cancellationPolicy: v1 } });
    const created = await new RequestService().createLead({
      tenantId: T1, kind: "reservation", status: "new", clientName: "X", clientPhone: "0", clientEmail: "x@example.test", rawPayload: {}, flatPayload: {},
    });
    const v2 = nextPolicy(cancellationPolicyInputSchema.parse({ freeCancellationHours: 48, customerText: "V2" }), v1);
    await prisma.tenant.update({ where: { id: T1 }, data: { cancellationPolicy: v2 } });
    const row = await prisma.leadRequest.findUniqueOrThrow({ where: { id: created.id } });
    const snap = row.cancellationPolicySnapshot as { policy: { version: number; customerText: string } };
    assert.equal(snap.policy.version, 1);
    assert.equal(snap.policy.customerText, "V1");
    await prisma.tenant.update({ where: { id: T1 }, data: { cancellationPolicy: client.Prisma.DbNull } });
  });

  it("statistiques super-admin : brut, remboursé, net, commissions nettes par tenant", async () => {
    const { getPlatformRefundStats } = await import("../../platform/platformRefundStats.controller");
    const lead = await seedLead(T1);
    const pay = await seedPayment(T1, lead.id);
    const gw = new helpers.FakeGateway();
    gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
    const { service } = install(gw);
    await service.requestRefund({ tenantId: T1, paymentId: pay.id, amountCents: 4_000, reason: "goodwill", clientRequestId: "it-stat-000001" });

    let body: { data: { items: Array<{ tenantId: string; grossCents: number; refundedCents: number; netRevenueCents: number; commissionNetCents: number; commissionRefundedCents: number }> } } | undefined;
    await getPlatformRefundStats({ query: { range: "all" } } as never, { json: (b: unknown) => { body = b as never; } } as never, (e?: unknown) => { throw e; });
    const row = body!.data.items.find((i) => i.tenantId === T1)!;
    assert.ok(row.grossCents >= 10_000);
    assert.ok(row.refundedCents >= 4_000);
    assert.equal(row.netRevenueCents, row.grossCents - row.refundedCents);
    assert.equal(row.commissionNetCents, (await prisma.payment.aggregate({ where: { tenantId: T1, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUND_FAILED", "REFUNDED"] } }, _sum: { applicationFeeAmount: true } }))._sum.applicationFeeAmount! - row.commissionRefundedCents);
  });
});
