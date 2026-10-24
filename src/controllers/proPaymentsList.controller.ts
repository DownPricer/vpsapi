import type { NextFunction, Request, Response } from "express";
import { PaymentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";

/** Paiements réellement encaissés (y compris ceux ensuite remboursés en tout ou partie). */
const COLLECTED_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUND_FAILED,
  PaymentStatus.REFUNDED,
];

const querySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  from: z.string().optional(),
  to: z.string().optional(),
});

function dateBounds(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const out: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) out.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) out.lte = d;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * GET /api/pro/payments — historique paiements du tenant (auth pro).
 */
export async function getProPaymentsList(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Paramètres de liste invalides." },
    });
    return;
  }

  const tenantId = req.authUser?.tenantId;
  if (!tenantId || !req.authUser) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }

  const { status, limit, offset, from, to } = parsed.data;
  const createdFilter = dateBounds(from, to);

  const baseWhere = {
    tenantId,
    ...(createdFilter ? { createdAt: createdFilter } : {}),
  };

  const where = {
    ...baseWhere,
    ...(status ? { status } : {}),
  };

  try {
    const chartFrom = new Date();
    chartFrom.setMonth(chartFrom.getMonth() - 5);
    chartFrom.setDate(1);
    chartFrom.setHours(0, 0, 0, 0);

    const [
      items,
      total,
      aggPaid,
      aggRefunded,
      pendingCheckoutCount,
      failedCount,
      expiredCount,
      monthlyPaidRows,
    ] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          status: true,
          mode: true,
          amount: true,
          currency: true,
          stripeReceiptUrl: true,
          leadRequestId: true,
          refundedAmount: true,
          applicationFeeAmount: true,
          applicationFeeRefundedAmount: true,
          leadRequest: { select: { clientName: true } },
        },
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where: { ...where, status: { in: COLLECTED_STATUSES } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { ...where, status: { in: COLLECTED_STATUSES } },
        _sum: { refundedAmount: true },
      }),
      prisma.payment.count({
        where: {
          ...baseWhere,
          status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
        },
      }),
      prisma.payment.count({ where: { ...where, status: PaymentStatus.FAILED } }),
      prisma.payment.count({ where: { ...where, status: PaymentStatus.EXPIRED } }),
      prisma.$queryRaw<Array<{ ym: Date; total: bigint }>>(
        Prisma.sql`
          SELECT date_trunc('month', "paidAt") AS ym, SUM(amount) AS total
          FROM "Payment"
          WHERE "tenantId" = ${tenantId}
            AND status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED')
            AND "paidAt" IS NOT NULL
            AND "paidAt" >= ${chartFrom}
          GROUP BY 1
          ORDER BY 1 ASC
        `
      ),
    ]);

    const monthlyPaid = monthlyPaidRows.map((row) => ({
      monthKey: row.ym.toISOString().slice(0, 7),
      monthLabel: row.ym.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }),
      totalCents: Number(row.total),
    }));

    res.json({
      success: true,
      data: {
        items: items.map((p) => ({
          id: p.id,
          createdAt: p.createdAt,
          status: p.status,
          mode: p.mode,
          amount: p.amount,
          currency: p.currency,
          stripeReceiptUrl: p.stripeReceiptUrl,
          refundedAmount: p.refundedAmount,
          refundableAmount: Math.max(0, p.amount - p.refundedAmount),
          applicationFeeAmount: p.applicationFeeAmount,
          applicationFeeRefundedAmount: p.applicationFeeRefundedAmount,
          leadRequestId: p.leadRequestId,
          clientName: p.leadRequest?.clientName ?? "",
        })),
        total,
        summary: {
          paidTotalCents: aggPaid._sum.amount ?? 0,
          refundedTotalCents: aggRefunded._sum.refundedAmount ?? 0,
          netTotalCents: (aggPaid._sum.amount ?? 0) - (aggRefunded._sum.refundedAmount ?? 0),
          paidCount: aggPaid._count,
          pendingCheckoutCount,
          failedCount,
          expiredCount,
        },
        monthlyPaid,
      },
    });
  } catch (e) {
    next(e);
  }
}
