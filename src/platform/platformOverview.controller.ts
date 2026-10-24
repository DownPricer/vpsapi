import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";
import { loadEnv } from "../config/env";
import { getPlatformUsageSummary } from "./apiUsage";

const isSet = (v: string | undefined): boolean => Boolean(v && v.trim());

export async function getPlatformHealth(_req: Request, res: Response): Promise<void> {
  const env = loadEnv();
  let db: { ok: boolean; latencyMs: number | null } = { ok: false, latencyMs: null };
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    db = { ok: false, latencyMs: null };
  }
  const mem = process.memoryUsage();
  // health "safe" : booléens de configuration uniquement, aucun secret exposé
  res.status(200).json({
    success: true,
    data: {
      ok: db.ok,
      service: "vtc-core-api",
      time: new Date().toISOString(),
      features: {
        platformAdminEnabled: env.platformAdminEnabled,
        telemetryEnabled: env.telemetryEnabled,
      },
      runtime: {
        env: env.nodeEnv,
        nodeVersion: process.version,
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
      },
      db,
      integrations: {
        stripe: isSet(process.env.STRIPE_SECRET_KEY),
        stripeWebhook: isSet(process.env.STRIPE_WEBHOOK_SECRET),
        smtp: isSet(process.env.SMTP_HOST) && isSet(process.env.SMTP_PORT),
        distanceMatrix: isSet(process.env.DISTANCE_MATRIX_API_KEY),
        jwtSecrets: isSet(process.env.JWT_ACCESS_SECRET) && isSet(process.env.JWT_REFRESH_SECRET),
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
      usage,
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
      getPlatformUsageSummary(range),
    ]);

    // Période précédente de même durée, pour afficher les tendances (absente sur « all »).
    const previous = from
      ? await (async () => {
          const spanMs = to.getTime() - from.getTime();
          const prevFrom = new Date(from.getTime() - spanMs);
          const [leads, paidAgg, paid, emailsSent, emailsFailed] = await Promise.all([
            prisma.leadRequest.count({ where: { createdAt: { gte: prevFrom, lt: from } } }),
            prisma.payment.aggregate({
              where: { status: "PAID", paidAt: { gte: prevFrom, lt: from } },
              _sum: { amount: true, applicationFeeAmount: true },
            }),
            prisma.payment.count({ where: { status: "PAID", paidAt: { gte: prevFrom, lt: from } } }),
            prisma.leadRequest.count({ where: { createdAt: { gte: prevFrom, lt: from }, emailSentAt: { not: null } } }),
            prisma.leadRequest.count({ where: { createdAt: { gte: prevFrom, lt: from }, emailError: { not: null } } }),
          ]);
          return {
            leadsInRange: leads,
            paidInRange: paid,
            amountPaidInRangeCents: paidAgg._sum.amount ?? 0,
            platformFeesInRangeCents: paidAgg._sum.applicationFeeAmount ?? 0,
            emailsSent,
            emailsFailed,
          };
        })()
      : null;

    const rangeWhere = from ? { createdAt: { gte: from, lte: to } } : {};
    const [emailsSentInRange, emailsFailedInRange] = await Promise.all([
      prisma.leadRequest.count({ where: { ...rangeWhere, emailSentAt: { not: null } } }),
      prisma.leadRequest.count({ where: { ...rangeWhere, emailError: { not: null } } }),
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
          emailsSentInRange,
          emailsFailedInRange,
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
        previous,
        telemetry: {
          eventsInRange,
        },
        usage,
        notes: {
          visitors: "non_disponible_v1",
          mailStats: "partiel (LeadRequest.emailSentAt/emailError + events si activés)",
          pricingCalculations: "disponible via PlatformEvent calculator_quote_* et api_usage_*",
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

