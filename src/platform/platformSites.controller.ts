import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";
import { auditTenantContent } from "./auditTenantContent";
import { computeSitePlan } from "./sitePlan";

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

function detectPricingSuspect(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const s = settings as any;
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

export async function getPlatformSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";

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

    // Agrégations events (range) par tenant/type (pour statut + actions)
    const eventRows = await prisma.$queryRaw<Array<{ tenantId: string; type: string; cnt: bigint }>>`
      SELECT "tenantId" as "tenantId", "type" as "type", count(*)::bigint as cnt
      FROM "PlatformEvent"
      WHERE "tenantId" IS NOT NULL
        AND "createdAt" >= ${from ?? new Date(0)} AND "createdAt" <= ${to}
      GROUP BY 1, 2
    `;
    const eventMap = new Map<string, Record<string, number>>();
    for (const r of eventRows) {
      const m = eventMap.get(r.tenantId) ?? {};
      m[r.type] = (m[r.type] ?? 0) + Number(r.cnt);
      eventMap.set(r.tenantId, m);
    }

    const emailFailedLeadsAgg = await prisma.leadRequest.groupBy({
      by: ["tenantId"],
      where: {
        ...(from ? { createdAt: { gte: from, lte: to } } : {}),
        emailError: { not: null },
      },
      _count: { _all: true },
    });
    const emailFailedLeadsMap = new Map<string, number>(emailFailedLeadsAgg.map((r) => [r.tenantId, r._count._all]));

    const lastEventAgg = await prisma.platformEvent.groupBy({
      by: ["tenantId"],
      where: { tenantId: { not: null } },
      _max: { createdAt: true },
    });
    const lastLeadAgg = await prisma.leadRequest.groupBy({ by: ["tenantId"], _max: { createdAt: true } });
    const lastPayAgg = await prisma.payment.groupBy({ by: ["tenantId"], _max: { paidAt: true, createdAt: true } });
    const lastEventMap = new Map<string, Date>(
      lastEventAgg
        .filter((r) => r.tenantId && r._max.createdAt)
        .map((r) => [r.tenantId as string, r._max.createdAt as Date])
    );
    const lastLeadMap = new Map<string, Date>(
      lastLeadAgg.filter((r) => r._max.createdAt).map((r) => [r.tenantId, r._max.createdAt as Date])
    );
    const lastPayMap = new Map<string, Date>(
      lastPayAgg.map((r) => [
        r.tenantId,
        ((r._max.paidAt as Date) ?? (r._max.createdAt as Date)) as Date,
      ])
    );

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
        const audit = auditTenantContent(t.settings);
        const stripeConnected = Boolean(t.stripeAccountId);
        const stripeOk = stripeConnected && t.stripeChargesEnabled && t.stripeDetailsSubmitted;
        const evCounts = eventMap.get(t.id) ?? {};
        const errorsCount = (evCounts.api_error ?? 0) + (evCounts.admin_error ?? 0);
        const calculatorFailedCount = evCounts.calculator_quote_failed ?? 0;
        const emailFailedCount = (evCounts.email_failed ?? 0) + (emailFailedLeadsMap.get(t.id) ?? 0);
        const paymentFailedCount = (evCounts.payment_failed ?? 0) + (payMap.get(t.id)?.failed ?? 0);
        const paymentPaidCount = payMap.get(t.id)?.paid ?? 0;
        const pricingSuspect = detectPricingSuspect(t.settings);

        const candidates: Date[] = [];
        const le = lastEventMap.get(t.id);
        const ll = lastLeadMap.get(t.id);
        const lp = lastPayMap.get(t.id);
        if (le) candidates.push(le);
        if (ll) candidates.push(ll);
        if (lp) candidates.push(lp);
        const lastActivityAt = candidates.length > 0 ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : t.updatedAt;

        const plan = computeSitePlan({
          tenantId: t.id,
          active: t.active,
          settingsPresent: t.settings != null,
          stripeConnected,
          stripeOk,
          audit,
          lastActivityAt,
          eventCounts: evCounts,
          emailFailedCount,
          paymentFailedCount,
          paymentPaidCount,
          calculatorFailedCount,
          errorsCount,
          pricingSuspect,
        });

        const alerts: Array<{ severity: "critique" | "warning" | "info"; label: string }> = [];
        for (const act of plan.actions.filter((x) => x.statut === "a_faire").slice(0, 3)) {
          alerts.push({ severity: act.gravite === "critique" ? "critique" : act.gravite === "warning" ? "warning" : "info", label: act.action });
        }

        const inRange = leadInRangeMap.get(t.id) ?? 0;
        const total = leadTotalMap.get(t.id) ?? 0;
        const pay = payMap.get(t.id) ?? { paid: 0, failed: 0, amountPaidCents: 0 };
        const amountPaidTotalCents = paidAllMap.get(t.id) ?? 0;
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
          status: {
            // legacy (compat UI V2 précédente)
            global: plan.legacyStatus,
            // V2 premium
            globalFine: plan.fineStatus,
            globalLabel: plan.fineLabel,
            priority: plan.priority,
            riskScore: plan.riskScore,
            readinessScore: audit.readinessScore,
            accentsOk: audit.corruptedTextFieldsCount === 0,
            contentOk: audit.readinessScore >= 85,
            stripeConnected,
            stripeOk,
            daysSinceActivity: plan.daysSinceActivity,
            reasons: plan.reasons,
            nextAction: plan.nextAction,
          },
          plan: {
            actions: plan.actions,
          },
          alerts,
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
      })
      .filter((r) => {
        if (!statusFilter) return true;
        const fine = (r as any).status?.globalFine;
        const legacy = (r as any).status?.global;
        if (statusFilter === "ok") return fine === "ok" || legacy === "ok";
        if (statusFilter === "a_configurer" || statusFilter === "configurer") return fine === "a_configurer";
        if (statusFilter === "incomplet") return fine === "incomplet";
        if (statusFilter === "risque") return fine === "risque";
        if (statusFilter === "warning") return legacy === "warning";
        if (statusFilter === "erreur" || statusFilter === "error") return fine === "erreur" || legacy === "erreur";
        if (statusFilter === "inactif" || statusFilter === "inactive") return legacy === "inactif";
        if (statusFilter === "stripe") return (r as any).status?.stripeConnected === false;
        if (statusFilter === "contenu") return (r as any).status?.contentOk === false;
        return true;
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
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
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
        ...(from ? { createdAt: { gte: from, lte: to } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.status(200).json({ success: true, data: { tenantId, range, count: events.length, events } });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  const takeRaw = typeof req.query.take === "string" ? Number.parseInt(req.query.take, 10) : 200;
  const take = Number.isFinite(takeRaw) ? Math.max(1, Math.min(500, takeRaw)) : 200;
  try {
    const events = await prisma.platformEvent.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(type ? { type } : {}),
        ...(from ? { createdAt: { gte: from, lte: to } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.status(200).json({ success: true, data: { range, count: events.length, events } });
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

