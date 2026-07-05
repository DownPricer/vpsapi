import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";
import { auditTenantContent } from "./auditTenantContent";

function safeString(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function pickSettingsIdentity(settings: unknown): {
  commercialName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  siteUrl?: string | null;
  adminUrl?: string | null;
} {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const s = settings as Record<string, unknown>;
  const branding = (s.branding && typeof s.branding === "object" && !Array.isArray(s.branding)) ? (s.branding as Record<string, unknown>) : null;
  const company = (s.company && typeof s.company === "object" && !Array.isArray(s.company)) ? (s.company as Record<string, unknown>) : null;
  const contact = (s.contact && typeof s.contact === "object" && !Array.isArray(s.contact)) ? (s.contact as Record<string, unknown>) : null;

  const commercialName = safeString(branding?.name) ?? safeString(company?.name) ?? null;
  const companyName = safeString(company?.legalName) ?? safeString(company?.name) ?? null;
  const email = safeString(contact?.email) ?? safeString(company?.email) ?? null;
  const phone = safeString(contact?.phone) ?? safeString(company?.phone) ?? null;
  const city = safeString(company?.city) ?? null;
  const siteUrl = safeString(branding?.siteUrl) ?? null;
  const adminUrl = safeString(branding?.adminUrl) ?? null;
  return { commercialName, companyName, email, phone, city, siteUrl, adminUrl };
}

export async function getPlatformSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);

  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        name: true,
        slug: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        settings: true,
        stripeAccountId: true,
        stripeOnboardingStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        paymentOnlineEnabled: true,
        paymentMode: true,
      },
    });

    // Agrégations (range) : leads + paiements
    const leadAgg = await prisma.leadRequest.groupBy({
      by: ["tenantId"],
      where: from ? { createdAt: { gte: from, lte: to } } : {},
      _count: { _all: true },
      orderBy: { tenantId: "asc" },
    });
    const leadTotalAgg = await prisma.leadRequest.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      orderBy: { tenantId: "asc" },
    });
    const payAgg = await prisma.payment.groupBy({
      by: ["tenantId", "status"],
      where: from ? { createdAt: { gte: from, lte: to } } : {},
      _count: { _all: true },
      _sum: { amount: true },
    });
    const payPaidAll = await prisma.payment.groupBy({
      by: ["tenantId"],
      where: { status: "PAID" },
      _sum: { amount: true },
    });

    const leadInRangeMap = new Map<string, number>(leadAgg.map((r) => [r.tenantId, r._count._all]));
    const leadTotalMap = new Map<string, number>(leadTotalAgg.map((r) => [r.tenantId, r._count._all]));
    const paidAllMap = new Map<string, number>(payPaidAll.map((r) => [r.tenantId, r._sum.amount ?? 0]));

    const payMap = new Map<string, { paid: number; failed: number; amountPaidCents: number }>();
    for (const r of payAgg) {
      const cur = payMap.get(r.tenantId) ?? { paid: 0, failed: 0, amountPaidCents: 0 };
      if (r.status === "PAID") {
        cur.paid += r._count._all;
        cur.amountPaidCents += r._sum.amount ?? 0;
      } else if (r.status === "FAILED") {
        cur.failed += r._count._all;
      }
      payMap.set(r.tenantId, cur);
    }

    const rows = tenants
      .map((t) => {
        const ident = pickSettingsIdentity(t.settings);
        const inRange = leadInRangeMap.get(t.id) ?? 0;
        const total = leadTotalMap.get(t.id) ?? 0;
        const pay = payMap.get(t.id) ?? { paid: 0, failed: 0, amountPaidCents: 0 };
        const amountPaidTotalCents = paidAllMap.get(t.id) ?? 0;
        const lastActivityAt = t.updatedAt;
        return {
          tenantId: t.id,
          name: ident.commercialName ?? t.name,
          companyName: ident.companyName ?? null,
          email: ident.email ?? null,
          phone: ident.phone ?? null,
          city: ident.city ?? null,
          active: t.active,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          siteUrl: ident.siteUrl ?? null,
          adminUrl: ident.adminUrl ?? null,
          stripe: {
            accountIdPresent: Boolean(t.stripeAccountId),
            onboardingStatus: t.stripeOnboardingStatus,
            chargesEnabled: t.stripeChargesEnabled,
            payoutsEnabled: t.stripePayoutsEnabled,
            detailsSubmitted: t.stripeDetailsSubmitted,
          },
          payment: {
            onlineEnabled: t.paymentOnlineEnabled,
            mode: t.paymentMode,
          },
          metrics: {
            leadsTotal: total,
            leadsInRange: inRange,
            paymentsPaidInRange: pay.paid,
            paymentsFailedInRange: pay.failed,
            amountPaidInRangeCents: pay.amountPaidCents,
            amountPaidTotalCents,
          },
          lastActivityAt,
        };
      })
      .filter((r) => {
        if (!q) return true;
        const needle = q.toLowerCase();
        return (
          r.tenantId.toLowerCase().includes(needle) ||
          (r.name ?? "").toLowerCase().includes(needle) ||
          (r.companyName ?? "").toLowerCase().includes(needle) ||
          (r.email ?? "").toLowerCase().includes(needle) ||
          (r.phone ?? "").toLowerCase().includes(needle) ||
          (r.siteUrl ?? "").toLowerCase().includes(needle)
        );
      });

    res.status(200).json({ success: true, data: { range, count: rows.length, sites: rows } });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformSiteByTenantId(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        active: true,
        settings: true,
        configRef: true,
        createdAt: true,
        updatedAt: true,
        stripeAccountId: true,
        stripeOnboardingStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        paymentOnlineEnabled: true,
        paymentMode: true,
        depositPercent: true,
        depositFixedAmount: true,
        paymentCurrency: true,
        platformApplicationFeeAmount: true,
      },
    });
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tenant introuvable." } });
      return;
    }
    const ident = pickSettingsIdentity(tenant.settings);
    res.status(200).json({
      success: true,
      data: {
        tenantId: tenant.id,
        name: ident.commercialName ?? tenant.name,
        companyName: ident.companyName ?? null,
        contact: { email: ident.email ?? null, phone: ident.phone ?? null },
        city: ident.city ?? null,
        active: tenant.active,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
        siteUrl: ident.siteUrl ?? null,
        adminUrl: ident.adminUrl ?? null,
        technical: { slug: tenant.slug, configRef: tenant.configRef ?? null },
        stripe: {
          accountIdPresent: Boolean(tenant.stripeAccountId),
          onboardingStatus: tenant.stripeOnboardingStatus,
          chargesEnabled: tenant.stripeChargesEnabled,
          payoutsEnabled: tenant.stripePayoutsEnabled,
          detailsSubmitted: tenant.stripeDetailsSubmitted,
        },
        payment: {
          onlineEnabled: tenant.paymentOnlineEnabled,
          mode: tenant.paymentMode,
          depositPercent: tenant.depositPercent,
          depositFixedAmount: tenant.depositFixedAmount,
          currency: tenant.paymentCurrency,
          platformApplicationFeeAmount: tenant.platformApplicationFeeAmount,
        },
        settingsPresent: tenant.settings != null,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformSiteMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }
  try {
    const [leadsCount, paymentsPaidAgg, paymentsFailedCount, eventsCount] = await Promise.all([
      prisma.leadRequest.count({
        where: {
          tenantId,
          ...(from ? { createdAt: { gte: from, lte: to } } : {}),
        },
      }),
      prisma.payment.aggregate({
        where: {
          tenantId,
          status: "PAID",
          ...(from ? { paidAt: { gte: from, lte: to } } : {}),
        },
        _count: { _all: true },
        _sum: { amount: true, applicationFeeAmount: true },
      }),
      prisma.payment.count({
        where: {
          tenantId,
          status: "FAILED",
          ...(from ? { failedAt: { gte: from, lte: to } } : {}),
        },
      }),
      prisma.platformEvent.count({
        where: {
          tenantId,
          ...(from ? { createdAt: { gte: from, lte: to } } : {}),
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        tenantId,
        range,
        leads: { count: leadsCount },
        payments: {
          paidCount: paymentsPaidAgg._count._all ?? 0,
          failedCount: paymentsFailedCount,
          amountPaidCents: paymentsPaidAgg._sum.amount ?? 0,
          platformFeesCents: paymentsPaidAgg._sum.applicationFeeAmount ?? 0,
        },
        telemetry: { eventsCount },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformSiteEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const takeRaw = typeof req.query.take === "string" ? Number.parseInt(req.query.take, 10) : 200;
  const take = Number.isFinite(takeRaw) ? Math.max(1, Math.min(500, takeRaw)) : 200;
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }
  try {
    const events = await prisma.platformEvent.findMany({
      where: {
        tenantId,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.status(200).json({ success: true, data: { tenantId, count: events.length, events } });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const takeRaw = typeof req.query.take === "string" ? Number.parseInt(req.query.take, 10) : 200;
  const take = Number.isFinite(takeRaw) ? Math.max(1, Math.min(500, takeRaw)) : 200;
  try {
    const events = await prisma.platformEvent.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.status(200).json({ success: true, data: { count: events.length, events } });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformSiteAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, settings: true, updatedAt: true, createdAt: true },
    });
    if (!tenant) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tenant introuvable." } });
      return;
    }
    const audit = auditTenantContent(tenant.settings);
    res.status(200).json({
      success: true,
      data: {
        tenantId: tenant.id,
        settingsUpdatedAt: tenant.updatedAt,
        createdAt: tenant.createdAt,
        audit,
      },
    });
  } catch (e) {
    next(e);
  }
}

