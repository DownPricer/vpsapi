import type { NextFunction, Request, Response } from "express";
import { RefundStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { COLLECTED_PAYMENT_STATUSES } from "../services/paymentStatuses";
import { parseRangeKey, rangeToDates } from "./platformQueries";

export type TenantRefundStats = {
  tenantId: string;
  tenantName: string;
  paymentsCount: number;
  grossCents: number;
  refundedCents: number;
  netRevenueCents: number;
  refundsCount: number;
  refundsPendingCount: number;
  refundsFailedCount: number;
  commissionCollectedCents: number;
  commissionRefundedCents: number;
  commissionNetCents: number;
};

/**
 * GET /api/platform/stripe/refund-stats?range= — lecture seule, par tenant.
 * Définitions : CA brut = paiements encaissés ; CA net = brut − remboursements confirmés ;
 * commission nette = commissions encaissées − commissions restituées par Stripe.
 */
export async function getPlatformRefundStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const range = parseRangeKey(req.query.range);
    const { from, to } = rangeToDates(range);
    const paidAtFilter = from ? { paidAt: { gte: from, lte: to } } : { paidAt: { not: null } };

    const [payments, refunds, tenants] = await Promise.all([
      prisma.payment.groupBy({
        by: ["tenantId"],
        where: { status: { in: COLLECTED_PAYMENT_STATUSES }, ...paidAtFilter },
        _count: { _all: true },
        _sum: { amount: true, refundedAmount: true, applicationFeeAmount: true, applicationFeeRefundedAmount: true },
      }),
      prisma.paymentRefund.groupBy({
        by: ["tenantId", "status"],
        where: from ? { createdAt: { gte: from, lte: to } } : {},
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.tenant.findMany({ select: { id: true, name: true } }),
    ]);

    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const rows = new Map<string, TenantRefundStats>();
    const row = (tenantId: string): TenantRefundStats => {
      let r = rows.get(tenantId);
      if (!r) {
        r = {
          tenantId,
          tenantName: names.get(tenantId) ?? tenantId,
          paymentsCount: 0,
          grossCents: 0,
          refundedCents: 0,
          netRevenueCents: 0,
          refundsCount: 0,
          refundsPendingCount: 0,
          refundsFailedCount: 0,
          commissionCollectedCents: 0,
          commissionRefundedCents: 0,
          commissionNetCents: 0,
        };
        rows.set(tenantId, r);
      }
      return r;
    };

    for (const p of payments) {
      const r = row(p.tenantId);
      r.paymentsCount = p._count._all;
      r.grossCents = p._sum.amount ?? 0;
      r.refundedCents = p._sum.refundedAmount ?? 0;
      r.commissionCollectedCents = p._sum.applicationFeeAmount ?? 0;
      r.commissionRefundedCents = p._sum.applicationFeeRefundedAmount ?? 0;
    }
    for (const g of refunds) {
      const r = row(g.tenantId);
      if (g.status === RefundStatus.SUCCEEDED) r.refundsCount += g._count._all;
      else if (g.status === RefundStatus.PENDING || g.status === RefundStatus.REQUIRES_ACTION) {
        r.refundsPendingCount += g._count._all;
      } else if (g.status === RefundStatus.FAILED) r.refundsFailedCount += g._count._all;
    }

    const items = [...rows.values()]
      .map((r) => ({
        ...r,
        netRevenueCents: r.grossCents - r.refundedCents,
        commissionNetCents: r.commissionCollectedCents - r.commissionRefundedCents,
      }))
      .sort((a, b) => b.grossCents - a.grossCents);

    const totals = items.reduce(
      (acc, r) => {
        acc.paymentsCount += r.paymentsCount;
        acc.grossCents += r.grossCents;
        acc.refundedCents += r.refundedCents;
        acc.netRevenueCents += r.netRevenueCents;
        acc.refundsCount += r.refundsCount;
        acc.refundsPendingCount += r.refundsPendingCount;
        acc.refundsFailedCount += r.refundsFailedCount;
        acc.commissionCollectedCents += r.commissionCollectedCents;
        acc.commissionRefundedCents += r.commissionRefundedCents;
        acc.commissionNetCents += r.commissionNetCents;
        return acc;
      },
      {
        paymentsCount: 0,
        grossCents: 0,
        refundedCents: 0,
        netRevenueCents: 0,
        refundsCount: 0,
        refundsPendingCount: 0,
        refundsFailedCount: 0,
        commissionCollectedCents: 0,
        commissionRefundedCents: 0,
        commissionNetCents: 0,
      }
    );

    res.json({ success: true, data: { range, items, totals } });
  } catch (e) {
    next(e);
  }
}
