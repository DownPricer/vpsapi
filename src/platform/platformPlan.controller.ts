import type { NextFunction, Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { auditTenantContent } from "./auditTenantContent";
import { computeSitePlan } from "./sitePlan";
import { parseRangeKey, rangeToDates } from "./platformQueries";

function detectPricingSuspect(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const s = settings as any;
  // Heuristique très prudente (lecture seule) : éviter les faux positifs.
  const pricing = s?.pricing ?? s?.tarifs ?? s?.pricingConfig ?? null;
  if (!pricing || typeof pricing !== "object") return false;
  const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const base = n(pricing?.baseVtc ?? pricing?.base ?? pricing?.basePrice);
  const km = n(pricing?.pricePerKm ?? pricing?.prixKm ?? pricing?.prixParKm);
  const min = n(pricing?.minimum ?? pricing?.min ?? pricing?.minimumPrice);
  const approach = n(pricing?.approach ?? pricing?.approche);
  const mult = n(pricing?.outOfZoneMultiplier ?? pricing?.multiplicateurHorsZone);

  if (base !== null && base <= 0) return true;
  if (km !== null && km <= 0) return true;
  if (min !== null && min <= 0) return true;
  if (approach !== null && approach <= 0) return true;
  if (mult !== null && mult < 1) return true;
  return false;
}

async function eventCountsForTenant(params: { tenantId: string; from: Date; to: Date }): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ type: string; cnt: bigint }>>`
    SELECT "type" as type, count(*)::bigint as cnt
    FROM "PlatformEvent"
    WHERE "tenantId" = ${params.tenantId}
      AND "createdAt" >= ${params.from} AND "createdAt" <= ${params.to}
    GROUP BY 1
  `;
  const map: Record<string, number> = {};
  for (const r of rows) map[r.type] = Number(r.cnt);
  return map;
}

async function lastActivityForTenant(tenantId: string): Promise<Date | null> {
  const [ev, lead, pay] = await Promise.all([
    prisma.platformEvent.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    prisma.leadRequest.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    prisma.payment.aggregate({ where: { tenantId }, _max: { paidAt: true, createdAt: true } }),
  ]);
  const candidates: Date[] = [];
  if (ev._max.createdAt) candidates.push(ev._max.createdAt);
  if (lead._max.createdAt) candidates.push(lead._max.createdAt);
  if (pay._max.paidAt) candidates.push(pay._max.paidAt);
  if (pay._max.createdAt) candidates.push(pay._max.createdAt);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

export async function getPlatformSitePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }

  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  const fromDate = from ?? DateTime.utc().minus({ days: 30 }).toJSDate();

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        active: true,
        settings: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripeDetailsSubmitted: true,
      },
    });
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tenant introuvable." } });
      return;
    }

    const [audit, eventCounts, emailFailedLead, payFailed, payPaid, lastActivityAt] = await Promise.all([
      Promise.resolve(auditTenantContent(tenant.settings)),
      eventCountsForTenant({ tenantId, from: fromDate, to }),
      prisma.leadRequest.count({
        where: { tenantId, createdAt: { gte: fromDate, lte: to }, emailError: { not: null } },
      }),
      prisma.payment.count({ where: { tenantId, status: "FAILED", createdAt: { gte: fromDate, lte: to } } }),
      prisma.payment.count({ where: { tenantId, status: "PAID", paidAt: { gte: fromDate, lte: to } } }),
      lastActivityForTenant(tenantId),
    ]);

    const pricingSuspect = detectPricingSuspect(tenant.settings);
    const errorsCount = (eventCounts.api_error ?? 0) + (eventCounts.admin_error ?? 0);
    const emailFailedCount = (eventCounts.email_failed ?? 0) + emailFailedLead;
    const paymentFailedCount = (eventCounts.payment_failed ?? 0) + payFailed;
    const calculatorFailedCount = eventCounts.calculator_quote_failed ?? 0;

    const plan = computeSitePlan({
      tenantId,
      active: tenant.active,
      settingsPresent: tenant.settings != null,
      stripeConnected: Boolean(tenant.stripeAccountId),
      stripeOk: Boolean(tenant.stripeAccountId) && tenant.stripeChargesEnabled && tenant.stripeDetailsSubmitted,
      audit,
      lastActivityAt,
      eventCounts,
      emailFailedCount,
      paymentFailedCount,
      paymentPaidCount: payPaid,
      calculatorFailedCount,
      errorsCount,
      pricingSuspect,
    });

    res.status(200).json({
      success: true,
      data: {
        tenantId,
        range,
        plan,
      },
    });
  } catch (e) {
    next(e);
  }
}

