/**
 * QA Passe 2 — concurrence, remboursements, webhooks, isolation tenant, DST.
 * Gaté par TEST_DATABASE_URL (même pattern que fleet.integration.test.ts).
 */
import "./helpers/qaEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { assertLocalTestDb } from "./helpers/qaEnv";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) {
  assertLocalTestDb(TEST_DB);
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_not_used_for_network";
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_qa_concurrency";
}

const suite = TEST_DB ? describe : describe.skip;

suite("QA concurrence (PostgreSQL jetable)", () => {
  let prisma: typeof import("../../db/prisma").prisma;
  let V: typeof import("../../services/vehicle.service");
  let A: typeof import("../../services/vehicleAvailability.service");
  let R: typeof import("../../services/request.service");
  let refundSvc: typeof import("../../services/stripe/refund.service");
  let helpers: typeof import("../helpers/refundFakes");
  let storeMod: typeof import("../../services/stripe/prismaRefundStore");
  let containerMod: typeof import("../../services/refundContainer");
  let webhookSvc: typeof import("../../services/stripeWebhook.service");
  let webhookCtl: typeof import("../../controllers/stripeWebhook.controller");
  let days: typeof import("../../modules/fleet/days");
  let reqs: InstanceType<typeof import("../../services/request.service").RequestService>;

  const TA = "qa_conc_a";
  const TB = "qa_conc_b";
  const UA = "qa_conc_user_a";
  const UB = "qa_conc_user_b";
  const ACCT1 = "acct_qa_conc_a";
  const ACCT2 = "acct_qa_conc_b";
  let seq = 0;

  const mkVehicle = (tenantId: string, name: string, extra: object = {}) =>
    V.createVehicle(tenantId, { name, passengerMax: 4, active: true, ...extra } as never);

  async function seedLead(
    tenantId: string,
    vehicleId: string | null,
    start: string,
    end?: string,
    extra: Record<string, unknown> = {}
  ) {
    seq += 1;
    return prisma.leadRequest.create({
      data: {
        tenantId,
        kind: "devis",
        status: "pending",
        clientName: `Client ${seq}`,
        clientPhone: "0600000000",
        clientEmail: `c${seq}@example.test`,
        rawPayload: { trajetClassique: { TCpassagers: "2" } },
        flatPayload: { ResumeTrajet: "A → B", TarifTotal: "140.00" },
        pricingResult: { tarif: 140, vehicleBasis: { kmApplicable: true, billableKm: 80, kmAmount: 160 } },
        scheduledStart: new Date(start),
        scheduledEnd: new Date(end ?? new Date(new Date(start).getTime() + 90 * 60000).toISOString()),
        ...(vehicleId ? { vehicleId } : {}),
        ...extra,
      } as never,
    });
  }

  const accept = (tenantId: string, leadId: string) =>
    reqs.updateStatus({ tenantId, leadId, nextStatus: "accepted" as never, changedByUserId: UA });

  async function seedPayment(
    tenantId: string,
    leadId: string,
    opts: { amount?: number; fee?: number; acct?: string } = {}
  ) {
    seq += 1;
    return prisma.payment.create({
      data: {
        tenantId,
        leadRequestId: leadId,
        status: "PAID",
        mode: "FULL",
        amount: opts.amount ?? 10_000,
        currency: "eur",
        applicationFeeAmount: opts.fee ?? 500,
        stripeAccountId: opts.acct ?? (tenantId === TA ? ACCT1 : ACCT2),
        stripePaymentIntentId: `pi_qa_${Date.now()}_${seq}`,
        stripeCheckoutSessionId: `cs_qa_${Date.now()}_${seq}`,
        paidAt: new Date(),
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

  before(async () => {
    prisma = (await import("../../db/prisma")).prisma;
    V = await import("../../services/vehicle.service");
    A = await import("../../services/vehicleAvailability.service");
    R = await import("../../services/request.service");
    refundSvc = await import("../../services/stripe/refund.service");
    helpers = await import("../helpers/refundFakes");
    storeMod = await import("../../services/stripe/prismaRefundStore");
    containerMod = await import("../../services/refundContainer");
    webhookSvc = await import("../../services/stripeWebhook.service");
    webhookCtl = await import("../../controllers/stripeWebhook.controller");
    days = await import("../../modules/fleet/days");
    reqs = new R.RequestService();

    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.tenant.create({
      data: { id: TA, name: "QA Conc A", slug: "qa-conc-a", stripeAccountId: ACCT1, stripeChargesEnabled: true },
    });
    await prisma.tenant.create({
      data: { id: TB, name: "QA Conc B", slug: "qa-conc-b", stripeAccountId: ACCT2, stripeChargesEnabled: true },
    });
    await prisma.operatorUser.create({
      data: { id: UA, tenantId: TA, email: "op@qa-conc-a.test", passwordHash: "x", role: "admin" },
    });
    await prisma.operatorUser.create({
      data: { id: UB, tenantId: TB, email: "op@qa-conc-b.test", passwordHash: "x", role: "admin" },
    });
  });

  after(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [TA, TB] } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  describe("occupation véhicule parallèle", () => {
    it("20 acceptations parallèles même véhicule/jour → exactement une réussit", async () => {
      const v = await mkVehicle(TA, "Conc 20");
      const leads = await Promise.all(
        Array.from({ length: 20 }, () => seedLead(TA, v.id, "2028-03-01T09:00:00Z"))
      );
      const results = await Promise.allSettled(leads.map((l) => accept(TA, l.id)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      assert.equal(ok, 1);
      for (const r of results) {
        if (r.status === "rejected") {
          assert.equal((r.reason as { code?: string }).code, "VEHICLE_UNAVAILABLE");
        }
      }
      assert.equal(await prisma.leadRequest.count({ where: { vehicleId: v.id, status: "accepted" } }), 1);
      assert.equal(await prisma.vehicleDayOccupation.count({ where: { vehicleId: v.id } }), 1);
    });

    it("20 créations parallèles de blocs indisponibilité même période → une seule réussit", async () => {
      const v = await mkVehicle(TA, "Bloc 20");
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          A.createVehicleBlock({
            tenantId: TA,
            vehicleId: v.id,
            startDay: "2028-04-10",
            endDay: "2028-04-12",
            reason: "maintenance",
            note: `round-${i}`,
          })
        )
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      assert.equal(ok, 1, `ok=${ok} statuses=${results.map((r) => r.status).join(",")}`);
      assert.equal(await prisma.vehicleBlock.count({ where: { vehicleId: v.id } }), 1);
    });
  });

  // ---------------------------------------------------------------------------
  describe("KO-m7 archive vs acceptation", () => {
    /**
     * Bug KO-m7 : archiveVehicle compte les occupations puis archive hors verrou —
     * une acceptation concurrente peut créer une occupation sur un véhicule déjà archivé.
     * Correctif proposé : même transaction / SELECT FOR UPDATE sur le véhicule.
     */
    it(
      "course check/archive : aucune occupation ne doit rester sur un véhicule archivé",
      { todo: true },
      async () => {
        let bugSeen = false;
        for (let round = 0; round < 25; round++) {
          const v = await mkVehicle(TA, `KO-m7 ${round}`);
          const lead = await seedLead(TA, v.id, `2028-06-${String((round % 28) + 1).padStart(2, "0")}T10:00:00Z`);
          const results = await Promise.allSettled([accept(TA, lead.id), V.archiveVehicle(TA, v.id)]);
          const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
          const occ = await prisma.vehicleDayOccupation.count({
            where: { vehicleId: v.id, leadId: { not: null } },
          });
          if (row.archivedAt && occ > 0) {
            bugSeen = true;
            break;
          }
          // Nettoyage si accept a gagné sans archive
          if (!row.archivedAt && results[0].status === "fulfilled") {
            await prisma.leadRequest.update({
              where: { id: lead.id },
              data: { status: "cancelled", cancelledAt: new Date() },
            });
            await A.syncLeadOccupation(prisma, lead.id);
            await V.archiveVehicle(TA, v.id).catch(() => undefined);
          }
        }
        // Invariant attendu (échoue tant que KO-m7 n'est pas corrigé si la course est hit) :
        assert.equal(bugSeen, false, "occupation sur véhicule archivé (KO-m7)");
      }
    );
  });

  // ---------------------------------------------------------------------------
  describe("remboursements concurrence", () => {
    it("même clientRequestId en parallèle → une seule ligne refund / un seul appel Stripe", async () => {
      const lead = await seedLead(TA, null, "2028-07-01T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: lead.id }, data: { status: "accepted" } });
      const pay = await seedPayment(TA, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      const input = {
        tenantId: TA,
        paymentId: pay.id,
        amountCents: 4_000,
        reason: "goodwill" as const,
        clientRequestId: "qa-dbl-0000001",
      };
      const results = await Promise.allSettled([
        service.requestRefund(input),
        service.requestRefund(input),
        service.requestRefund(input),
        service.requestRefund(input),
      ]);
      assert.ok(results.every((r) => r.status === "fulfilled"));
      assert.equal(await prisma.paymentRefund.count({ where: { paymentId: pay.id } }), 1);
      assert.equal(gw.refunds.length, 1);
    });

    it("ids différents sur paiement déjà remboursé → refus", async () => {
      const lead = await seedLead(TA, null, "2028-07-02T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: lead.id }, data: { status: "accepted" } });
      const pay = await seedPayment(TA, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      await service.requestRefund({
        tenantId: TA,
        paymentId: pay.id,
        full: true,
        reason: "goodwill",
        clientRequestId: "qa-full-0000001",
      });
      await assert.rejects(
        service.requestRefund({
          tenantId: TA,
          paymentId: pay.id,
          amountCents: 100,
          reason: "goodwill",
          clientRequestId: "qa-full-0000002",
        }),
        (e: unknown) =>
          e instanceof refundSvc.RefundServiceError &&
          (e.code === "AMOUNT_EXCEEDS_REFUNDABLE" || e.code === "PAYMENT_NOT_REFUNDABLE")
      );
      assert.equal(gw.refunds.length, 1);
    });

    it("somme des remboursements partiels ≤ montant payé", async () => {
      const lead = await seedLead(TA, null, "2028-07-03T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: lead.id }, data: { status: "accepted" } });
      const pay = await seedPayment(TA, lead.id, { amount: 10_000 });
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      await service.requestRefund({
        tenantId: TA,
        paymentId: pay.id,
        amountCents: 3_000,
        reason: "goodwill",
        clientRequestId: "qa-part-0000001",
      });
      await service.requestRefund({
        tenantId: TA,
        paymentId: pay.id,
        amountCents: 4_000,
        reason: "goodwill",
        clientRequestId: "qa-part-0000002",
      });
      await assert.rejects(
        service.requestRefund({
          tenantId: TA,
          paymentId: pay.id,
          amountCents: 4_000,
          reason: "goodwill",
          clientRequestId: "qa-part-0000003",
        }),
        (e: unknown) => e instanceof refundSvc.RefundServiceError && e.code === "AMOUNT_EXCEEDS_REFUNDABLE"
      );
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
      assert.ok(p.refundedAmount <= p.amount);
      assert.equal(p.refundedAmount, 7_000);
    });
  });

  // ---------------------------------------------------------------------------
  describe("webhook Stripe concurrence / sécurité", () => {
    it("même event 10× en parallèle → traité une seule fois", async () => {
      const lead = await seedLead(TA, null, "2028-08-01T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: lead.id }, data: { status: "accepted" } });
      const pay = await seedPayment(TA, lead.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      gw.addDashboardRefund(pay.stripePaymentIntentId!, 1_000);
      install(gw);

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe("sk_test_dummy");
      const eventId = `evt_qa_par_${Date.now()}`;
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        type: "charge.refunded",
        account: ACCT1,
        data: { object: { id: "ch_qa", object: "charge", payment_intent: pay.stripePaymentIntentId } },
      });
      const header = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: "whsec_test_qa_concurrency",
      });

      const call = async () => {
        const out = { code: 0 };
        const res = {
          status(c: number) {
            out.code = c;
            return this;
          },
          json() {
            return this;
          },
        };
        await webhookCtl.postStripeWebhook(
          { headers: { "stripe-signature": header }, body: Buffer.from(payload), ip: "127.0.0.1" } as never,
          res as never,
          (e?: unknown) => {
            if (e) throw e;
          }
        );
        return out.code;
      };

      const codes = await Promise.all(Array.from({ length: 10 }, () => call()));
      assert.ok(codes.every((c) => c === 200));
      assert.equal(await prisma.stripeWebhookEvent.count({ where: { stripeEventId: eventId } }), 1);
    });

    it("événements hors ordre + signature invalide + autre compte connecté", async () => {
      const lead = await seedLead(TA, null, "2028-08-02T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: lead.id }, data: { status: "accepted" } });
      const pay = await seedPayment(TA, lead.id);
      const gw = new helpers.FakeGateway();
      gw.newRefundStatus = "pending";
      gw.addCharge(pay.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);
      await service.requestRefund({
        tenantId: TA,
        paymentId: pay.id,
        full: true,
        reason: "goodwill",
        clientRequestId: "qa-wh-ord-00001",
      });
      gw.setRefundStatus(gw.refunds[0].id, "succeeded");

      // Hors ordre : updated avant created
      await webhookSvc.processStripeWebhookEvent({
        id: `evt_qa_ord_2_${Date.now()}`,
        type: "refund.updated",
        account: ACCT1,
        data: { object: { id: gw.refunds[0].id, payment_intent: pay.stripePaymentIntentId } },
      });
      await webhookSvc.processStripeWebhookEvent({
        id: `evt_qa_ord_1_${Date.now()}`,
        type: "refund.created",
        account: ACCT1,
        data: { object: { id: gw.refunds[0].id, payment_intent: pay.stripePaymentIntentId } },
      });
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status, "REFUNDED");

      // Signature invalide
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe("sk_test_dummy");
      const badPayload = JSON.stringify({
        id: `evt_qa_bad_${Date.now()}`,
        object: "event",
        type: "charge.refunded",
        account: ACCT1,
        data: { object: { id: "ch_x", object: "charge", payment_intent: pay.stripePaymentIntentId } },
      });
      const out = { code: 0 };
      await webhookCtl.postStripeWebhook(
        {
          headers: { "stripe-signature": "t=1,v1=deadbeef" },
          body: Buffer.from(badPayload),
          ip: "127.0.0.1",
        } as never,
        {
          status(c: number) {
            out.code = c;
            return this;
          },
          json() {
            return this;
          },
        } as never,
        (e?: unknown) => {
          if (e) throw e;
        }
      );
      assert.equal(out.code, 400);

      // Autre compte connecté : ne doit pas toucher le paiement T1
      const leadB = await seedLead(TB, null, "2028-08-03T09:00:00Z");
      await prisma.leadRequest.update({ where: { id: leadB.id }, data: { status: "accepted" } });
      const payB = await seedPayment(TB, leadB.id);
      const gwB = new helpers.FakeGateway();
      gwB.addCharge(payB.stripePaymentIntentId!, ACCT2, 10_000, 500);
      gwB.addDashboardRefund(payB.stripePaymentIntentId!, 2_000);
      install(gwB);

      const evtWrongAcct = {
        id: `evt_qa_wrong_${Date.now()}`,
        type: "charge.refunded" as const,
        account: ACCT1, // mauvais compte pour payB
        data: {
          object: {
            id: "ch_wrong",
            object: "charge",
            payment_intent: payB.stripePaymentIntentId,
          },
        },
      };
      // process avec account ACCT1 ne doit pas rembourser payB (account mismatch)
      await webhookSvc.processStripeWebhookEvent(evtWrongAcct).catch(() => undefined);
      const pB = await prisma.payment.findUniqueOrThrow({ where: { id: payB.id } });
      assert.equal(pB.refundedAmount, 0, "paiement tenant B intact si event account = A");

      // Event correctement signé pour ACCT2
      const goodPayload = JSON.stringify({
        id: `evt_qa_b_${Date.now()}`,
        object: "event",
        type: "charge.refunded",
        account: ACCT2,
        data: {
          object: { id: "ch_b", object: "charge", payment_intent: payB.stripePaymentIntentId },
        },
      });
      const header = stripe.webhooks.generateTestHeaderString({
        payload: goodPayload,
        secret: "whsec_test_qa_concurrency",
      });
      const okOut = { code: 0 };
      await webhookCtl.postStripeWebhook(
        {
          headers: { "stripe-signature": header },
          body: Buffer.from(goodPayload),
          ip: "127.0.0.1",
        } as never,
        {
          status(c: number) {
            okOut.code = c;
            return this;
          },
          json() {
            return this;
          },
        } as never,
        (e?: unknown) => {
          if (e) throw e;
        }
      );
      assert.equal(okOut.code, 200);
      const pB2 = await prisma.payment.findUniqueOrThrow({ where: { id: payB.id } });
      assert.equal(pB2.refundedAmount, 2_000);
      // paiement A inchangé
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).refundedAmount, 10_000);
    });
  });

  // ---------------------------------------------------------------------------
  describe("isolation multi-tenant", () => {
    it("tous IDs A lus/modifiés/supprimés avec contexte B → refus", async () => {
      const vA = await mkVehicle(TA, "Privé A");
      const leadA = await seedLead(TA, vA.id, "2028-09-01T09:00:00Z");
      await accept(TA, leadA.id);
      const block = await A.createVehicleBlock({
        tenantId: TA,
        vehicleId: vA.id,
        startDay: "2028-09-10",
        endDay: "2028-09-11",
        reason: "leave",
      });
      const payA = await seedPayment(TA, leadA.id);
      const gw = new helpers.FakeGateway();
      gw.addCharge(payA.stripePaymentIntentId!, ACCT1, 10_000, 500);
      const { service } = install(gw);

      assert.equal(await V.getProVehicle(TB, vA.id), null);
      await assert.rejects(V.updateVehicle(TB, vA.id, { name: "piraté" }), (e: { code?: string }) => e.code === "NOT_FOUND");
      await assert.rejects(V.archiveVehicle(TB, vA.id), (e: { code?: string }) => e.code === "NOT_FOUND");
      await assert.rejects(
        A.createVehicleBlock({
          tenantId: TB,
          vehicleId: vA.id,
          startDay: "2028-09-20",
          endDay: "2028-09-21",
          reason: "leave",
        }),
        (e: { code?: string }) => e.code === "NOT_FOUND"
      );
      assert.equal(await A.deleteVehicleBlock(TB, block.id), false);
      // updateStatus filtre par tenantId : lead d'un autre tenant → null (pas d'exception).
      assert.equal(
        await reqs.updateStatus({
          tenantId: TB,
          leadId: leadA.id,
          nextStatus: "refused" as never,
          changedByUserId: UB,
        }),
        null
      );
      await assert.rejects(
        service.requestRefund({
          tenantId: TB,
          paymentId: payA.id,
          full: true,
          reason: "goodwill",
          clientRequestId: "qa-xten-0000001",
        }),
        (e: unknown) => e instanceof refundSvc.RefundServiceError && e.code === "PAYMENT_NOT_FOUND"
      );
      // A intact
      assert.ok(await V.getProVehicle(TA, vA.id));
      assert.equal((await prisma.leadRequest.findUniqueOrThrow({ where: { id: leadA.id } })).status, "accepted");
      assert.equal(await prisma.vehicleBlock.count({ where: { id: block.id } }), 1);
    });
  });

  // ---------------------------------------------------------------------------
  describe("DST Europe/Paris — réservation minuit", () => {
    it("dernier dimanche mars/octobre : jours civils locaux corrects à minuit", async () => {
      // Passage heure d'été 2026 : 29 mars
      assert.deepEqual(
        days.localDaysBetween(new Date("2026-03-28T22:30:00Z"), new Date("2026-03-29T01:30:00Z"), "Europe/Paris"),
        ["2026-03-28", "2026-03-29"]
      );
      // Passage heure d'hiver 2026 : 25 octobre (3h CEST → 2h CET).
      // 21:30Z le 24 = 23:30 CEST le 24 ; 01:00Z le 25 = 03:00 CEST / 02:00 CET le 25.
      assert.deepEqual(
        days.localDaysBetween(new Date("2026-10-24T21:30:00Z"), new Date("2026-10-25T01:00:00Z"), "Europe/Paris"),
        ["2026-10-24", "2026-10-25"]
      );
      // 22:00Z le 24 = déjà 00:00 CEST le 25 → un seul jour civil.
      assert.deepEqual(
        days.localDaysBetween(new Date("2026-10-24T22:00:00Z"), new Date("2026-10-25T01:00:00Z"), "Europe/Paris"),
        ["2026-10-25"]
      );

      const vSpring = await mkVehicle(TA, "DST printemps");
      // 29 mars 2026 00:30 Europe/Paris = 2026-03-28T23:30:00Z (CET) … wait: after DST it's CEST.
      // Minuit local 29 mars 2026 = 2026-03-28T23:00:00Z (début CEST).
      const midnightSpring = "2026-03-28T23:00:00.000Z";
      const leadS = await seedLead(TA, vSpring.id, midnightSpring, "2026-03-29T01:00:00.000Z");
      await accept(TA, leadS.id);
      const occS = (
        await prisma.vehicleDayOccupation.findMany({
          where: { vehicleId: vSpring.id },
          orderBy: { day: "asc" },
        })
      ).map((o) => o.day.toISOString().slice(0, 10));
      assert.ok(occS.includes("2026-03-29"), `attendu 2026-03-29, got ${occS.join(",")}`);

      const vFall = await mkVehicle(TA, "DST automne");
      // 25 oct 2026 00:30 Europe/Paris (CEST encore jusqu'à 3h) = 2026-10-24T22:30:00Z
      const midnightFall = "2026-10-24T22:30:00.000Z";
      const leadF = await seedLead(TA, vFall.id, midnightFall, "2026-10-25T01:30:00.000Z");
      await accept(TA, leadF.id);
      const occF = (
        await prisma.vehicleDayOccupation.findMany({
          where: { vehicleId: vFall.id },
          orderBy: { day: "asc" },
        })
      ).map((o) => o.day.toISOString().slice(0, 10));
      assert.ok(occF.includes("2026-10-25"), `attendu 2026-10-25, got ${occF.join(",")}`);
      assert.deepEqual(
        days.localDaysBetween(new Date(midnightFall), new Date("2026-10-25T01:30:00.000Z"), "Europe/Paris"),
        occF
      );
    });
  });
});
