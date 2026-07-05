import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";
import { loadEnv } from "../config/env";

export async function getPlatformHealth(_req: Request, res: Response): Promise<void> {
  const env = loadEnv();
  // health "safe" : pas d’expo de secrets
  res.status(200).json({
    success: true,
    data: {
      ok: true,
      service: "vtc-core-api",
      time: new Date().toISOString(),
      features: {
        platformAdminEnabled: env.platformAdminEnabled,
        telemetryEnabled: env.telemetryEnabled,
      },
    },
  });
}

export async function getPlatformOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const range = parseRangeKey(req.query.range);
  const { from, to } = rangeToDates(range);

  try {
    const [
      tenantsTotal,
      tenantsActive,
      leadsTotal,
      leadsInRange,
      paymentsPaidTotal,
      paymentsPaidInRange,
      paymentsFailedInRange,
      eventsInRange,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { active: true } }),
      prisma.leadRequest.count(),
      prisma.leadRequest.count({ where: from ? { createdAt: { gte: from, lte: to } } : {} }),
      prisma.payment.count({ where: { status: "PAID" } }),
      prisma.payment.count({
        where: {
          status: "PAID",
          ...(from ? { paidAt: { gte: from, lte: to } } : {}),
        },
      }),
      prisma.payment.count({
        where: {
          status: "FAILED",
          ...(from ? { failedAt: { gte: from, lte: to } } : {}),
        },
      }),
      prisma.platformEvent.count({
        where: from ? { createdAt: { gte: from, lte: to } } : {},
      }),
    ]);

    const revenuePaidTotalAgg = await prisma.payment.aggregate({
      where: { status: "PAID" },
      _sum: { amount: true, applicationFeeAmount: true },
    });
    const revenuePaidInRangeAgg = await prisma.payment.aggregate({
      where: {
        status: "PAID",
        ...(from ? { paidAt: { gte: from, lte: to } } : {}),
      },
      _sum: { amount: true, applicationFeeAmount: true },
    });

    res.status(200).json({
      success: true,
      data: {
        range,
        tenants: {
          total: tenantsTotal,
          active: tenantsActive,
          inactive: tenantsTotal - tenantsActive,
        },
        leads: {
          total: leadsTotal,
          inRange: leadsInRange,
        },
        payments: {
          paidTotal: paymentsPaidTotal,
          paidInRange: paymentsPaidInRange,
          failedInRange: paymentsFailedInRange,
          amountPaidTotalCents: revenuePaidTotalAgg._sum.amount ?? 0,
          amountPaidInRangeCents: revenuePaidInRangeAgg._sum.amount ?? 0,
          platformFeesTotalCents: revenuePaidTotalAgg._sum.applicationFeeAmount ?? 0,
          platformFeesInRangeCents: revenuePaidInRangeAgg._sum.applicationFeeAmount ?? 0,
        },
        telemetry: {
          eventsInRange,
        },
        notes: {
          visitors: "non_disponible_v1",
          mailStats: "partiel (LeadRequest.emailSentAt/emailError + events si activés)",
          pricingCalculations: "non_disponible_v1 (prévu via PlatformEvent)",
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

