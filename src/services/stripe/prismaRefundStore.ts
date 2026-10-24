import { LeadPaymentStatus, PaymentStatus, Prisma, RefundInitiator, RefundStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../db/prisma";
import { refundableCents, sumRefunds } from "./refundMath";
import type {
  NotificationKind,
  PaymentAggregatePatch,
  PaymentRecord,
  RefundRecord,
  RefundStore,
  ReserveInput,
  ReserveResult,
} from "./refund.types";

const REFUNDABLE: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_FAILED,
  PaymentStatus.REFUND_PENDING,
];

const paymentSelect = {
  id: true,
  tenantId: true,
  leadRequestId: true,
  status: true,
  amount: true,
  currency: true,
  applicationFeeAmount: true,
  stripeAccountId: true,
  stripePaymentIntentId: true,
  stripeChargeId: true,
  stripeApplicationFeeId: true,
  refundedAmount: true,
  applicationFeeRefundedAmount: true,
  tenant: { select: { stripeAccountId: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

function toRecord(p: PaymentRow): PaymentRecord {
  const { tenant, ...rest } = p;
  return { ...rest, tenantStripeAccountId: tenant.stripeAccountId };
}

export class PrismaRefundStore implements RefundStore {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async getPayment(tenantId: string, paymentId: string): Promise<PaymentRecord | null> {
    const p = await this.db.payment.findFirst({ where: { id: paymentId, tenantId }, select: paymentSelect });
    return p ? toRecord(p) : null;
  }

  async getPaymentByIntent(accountId: string, paymentIntentId: string): Promise<PaymentRecord | null> {
    const p = await this.db.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId, stripeAccountId: accountId },
      select: paymentSelect,
    });
    return p ? toRecord(p) : null;
  }

  async setPaymentCharge(paymentId: string, charge: { chargeId: string; applicationFeeId: string | null }): Promise<void> {
    await this.db.payment.update({
      where: { id: paymentId },
      data: { stripeChargeId: charge.chargeId, stripeApplicationFeeId: charge.applicationFeeId },
    });
  }

  /**
   * Verrou de ligne sur le paiement (SELECT … FOR UPDATE) : deux demandes simultanées sont sérialisées,
   * la seconde voit la réservation de la première et ne peut pas dépasser le solde remboursable.
   */
  async reserveRefund(input: ReserveInput): Promise<ReserveResult> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;

        const existing = await tx.paymentRefund.findUnique({
          where: {
            paymentId_clientRequestId: { paymentId: input.paymentId, clientRequestId: input.clientRequestId },
          },
        });
        if (existing) return { kind: "existing", refund: existing } as const;

        const payment = await tx.payment.findFirst({
          where: { id: input.paymentId, tenantId: input.tenantId },
          select: { amount: true, status: true, currency: true, leadRequestId: true },
        });
        const refunds = await tx.paymentRefund.findMany({ where: { paymentId: input.paymentId } });
        const totals = sumRefunds(refunds);
        const refundable = payment ? refundableCents(payment.amount, totals) : 0;

        if (!payment || !REFUNDABLE.includes(payment.status)) {
          return { kind: "rejected", code: "PAYMENT_NOT_REFUNDABLE", refundable } as const;
        }
        if (totals.inFlight > 0) {
          return { kind: "rejected", code: "REFUND_IN_PROGRESS", refundable } as const;
        }
        if (input.amount < 1 || input.amount > refundable) {
          return { kind: "rejected", code: "AMOUNT_EXCEEDS_REFUNDABLE", refundable } as const;
        }

        const created = await tx.paymentRefund.create({
          data: {
            tenantId: input.tenantId,
            paymentId: input.paymentId,
            leadRequestId: payment.leadRequestId,
            clientRequestId: input.clientRequestId,
            idempotencyKey: input.idempotencyKey,
            stripePaymentIntentId: input.stripePaymentIntentId,
            stripeChargeId: input.stripeChargeId,
            stripeAccountId: input.stripeAccountId,
            amount: input.amount,
            currency: payment.currency,
            status: RefundStatus.PENDING,
            reason: input.reason,
            reasonNote: input.reasonNote,
            initiatedBy: input.initiatedBy,
            initiatedByUserId: input.initiatedByUserId,
            applicationFeeRefundExpected: input.expectedFee(totals),
          },
        });
        return { kind: "created", refund: created } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 }
    );
  }

  findRefundByStripeId(stripeRefundId: string): Promise<RefundRecord | null> {
    return this.db.paymentRefund.findUnique({ where: { stripeRefundId } });
  }

  findRefundById(refundId: string): Promise<RefundRecord | null> {
    return this.db.paymentRefund.findUnique({ where: { id: refundId } });
  }

  async createExternalRefund(input: Parameters<RefundStore["createExternalRefund"]>[0]): Promise<RefundRecord> {
    try {
      return await this.db.paymentRefund.create({
        data: {
          tenantId: input.tenantId,
          paymentId: input.paymentId,
          leadRequestId: input.leadRequestId,
          clientRequestId: `ext_${input.stripeRefundId}`,
          idempotencyKey: `ext_${input.stripeRefundId}`,
          stripeRefundId: input.stripeRefundId,
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeChargeId: input.stripeChargeId,
          stripeAccountId: input.stripeAccountId,
          amount: input.amount,
          currency: input.currency,
          status: input.status,
          failureReason: input.failureReason,
          reason: "stripe_dashboard",
          initiatedBy: RefundInitiator.STRIPE_DASHBOARD,
        },
      });
    } catch (e) {
      // Course entre deux webhooks : la ligne existe déjà.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const found = await this.db.paymentRefund.findUnique({ where: { stripeRefundId: input.stripeRefundId } });
        if (found) return found;
      }
      throw e;
    }
  }

  updateRefund(refundId: string, patch: Parameters<RefundStore["updateRefund"]>[1]): Promise<RefundRecord> {
    return this.db.paymentRefund.update({ where: { id: refundId }, data: patch });
  }

  listRefunds(paymentId: string): Promise<RefundRecord[]> {
    return this.db.paymentRefund.findMany({ where: { paymentId }, orderBy: { createdAt: "asc" } });
  }

  async savePaymentAggregate(paymentId: string, patch: PaymentAggregatePatch): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: patch.status,
          refundedAmount: patch.refundedAmount,
          applicationFeeRefundedAmount: patch.applicationFeeRefundedAmount,
          refundedAt: patch.refundedAt,
          refundsSyncedAt: patch.refundsSyncedAt,
        },
        select: { leadRequestId: true, tenantId: true },
      });
      await tx.leadRequest.updateMany({
        where: { id: payment.leadRequestId, tenantId: payment.tenantId },
        data: { paymentStatus: patch.leadPaymentStatus as LeadPaymentStatus },
      });
    });
  }

  async claimNotification(refundId: string, kind: NotificationKind): Promise<boolean> {
    const field =
      kind === "initiated" ? "notifiedInitiatedAt" : kind === "succeeded" ? "notifiedSucceededAt" : "notifiedFailedAt";
    const res = await this.db.paymentRefund.updateMany({
      where: { id: refundId, [field]: null },
      data: { [field]: new Date() },
    });
    return res.count === 1;
  }
}
