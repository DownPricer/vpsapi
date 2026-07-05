import type { NextFunction, Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates } from "./platformQueries";
import { auditTenantContent } from "./auditTenantContent";
import { computeSitePlan } from "./sitePlan";

type Severity = "critique" | "warning" | "info";

function severityRank(s: Severity): number {
  if (s === "critique") return 3;
  if (s === "warning") return 2;
  return 1;
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

export async function getPlatformAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const range = parseRangeKey(req.query.range, "30d");
  const { from, to } = rangeToDates(range);
  const fromDate = from ?? DateTime.utc().minus({ days: 30 }).toJSDate();

  try {
    const tenants = await prisma.tenant.findMany({
      take: 800,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        active: true,
        settings: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripeDetailsSubmitted: true,
        stripeOnboardingStatus: true,
        createdAt: true,
      },
    });

    const tenantIds = tenants.map((t) => t.id);

    const eventRows = await prisma.$queryRaw<Array<{ tenantId: string; type: string; cnt: bigint }>>`
      SELECT "tenantId" as "tenantId", "type" as "type", count(*)::bigint as cnt
      FROM "PlatformEvent"
      WHERE "tenantId" IS NOT NULL
        AND "tenantId" = ANY(${tenantIds}::text[])
        AND "createdAt" >= ${fromDate} AND "createdAt" <= ${to}
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
      where: { tenantId: { in: tenantIds }, createdAt: { gte: fromDate, lte: to }, emailError: { not: null } },
      _count: { _all: true },
    });
    const emailFailedLeadsMap = new Map<string, number>(emailFailedLeadsAgg.map((r) => [r.tenantId, r._count._all]));

    const payFailedAgg = await prisma.payment.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds }, status: "FAILED", createdAt: { gte: fromDate, lte: to } },
      _count: { _all: true },
    });
    const payFailedMap = new Map<string, number>(payFailedAgg.map((r) => [r.tenantId, r._count._all]));

    const payPaidAgg = await prisma.payment.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds }, status: "PAID", paidAt: { gte: fromDate, lte: to } },
      _count: { _all: true },
    });
    const payPaidMap = new Map<string, number>(payPaidAgg.map((r) => [r.tenantId, r._count._all]));

    const [lastEvent, lastLead, lastPayment] = await Promise.all([
      prisma.platformEvent.groupBy({
        by: ["tenantId"],
        where: { tenantId: { not: null } },
        _max: { createdAt: true },
      }),
      prisma.leadRequest.groupBy({
        by: ["tenantId"],
        _max: { createdAt: true },
      }),
      prisma.payment.groupBy({
        by: ["tenantId"],
        _max: { paidAt: true, createdAt: true },
      }),
    ]);

    const lastEventMap = new Map<string, Date>(lastEvent.filter((r) => r.tenantId).map((r) => [r.tenantId as string, r._max.createdAt as Date]));
    const lastLeadMap = new Map<string, Date>(lastLead.map((r) => [r.tenantId, r._max.createdAt as Date]));
    const lastPayMap = new Map<string, Date>(
      lastPayment.map((r) => [r.tenantId, (r._max.paidAt as Date) ?? (r._max.createdAt as Date)])
    );

    const alerts: Array<{
      severity: Severity;
      tenantId: string;
      siteName: string;
      reason: string;
      detail?: string;
      lastActivityAt?: Date | null;
      actionSuggested?: string;
    }> = [];

    const priorityActions: Array<{
      priority: "critique" | "important" | "moyen" | "faible";
      tenantId: string;
      siteName: string;
      statusFine: string;
      problem: string;
      action: string;
      why: string;
      lastActivityAt?: Date | null;
    }> = [];

    const sites = tenants.map((t) => {
      const s = t.settings as any;
      const siteName =
        (s && typeof s === "object" && s.branding && typeof s.branding === "object" ? (s.branding as any).name : null) ||
        t.name;
      const audit = auditTenantContent(t.settings);

      const lastActivityAt = (() => {
        const candidates: Date[] = [];
        const ev = lastEventMap.get(t.id);
        const ld = lastLeadMap.get(t.id);
        const py = lastPayMap.get(t.id);
        if (ev) candidates.push(ev);
        if (ld) candidates.push(ld);
        if (py) candidates.push(py);
        if (candidates.length === 0) return null;
        return new Date(Math.max(...candidates.map((d) => d.getTime())));
      })();

      const daysSince =
        lastActivityAt ? Math.floor((DateTime.utc().toMillis() - DateTime.fromJSDate(lastActivityAt, { zone: "utc" }).toMillis()) / (1000 * 60 * 60 * 24)) : null;

      const stripeConnected = Boolean(t.stripeAccountId);
      const stripeOk = stripeConnected && t.stripeChargesEnabled && t.stripeDetailsSubmitted;

      const problems: string[] = [];
      if (!t.active) problems.push("Site inactif");
      if (!stripeConnected) problems.push("Stripe non connecté");
      else if (!stripeOk) problems.push("Stripe onboarding incomplet");
      if (audit.corruptedTextFieldsCount > 0) problems.push("Accents/encodage suspects");
      if (audit.placeholderFieldsCount > 0) problems.push("Textes de template détectés");
      if (audit.missingRequiredFields.length > 0) problems.push("Champs requis manquants");
      if (daysSince != null && daysSince >= 30) problems.push("Aucune activité récente (30j+)");

      // Plan (premium)
      const ev = eventMap.get(t.id) ?? {};
      const errorsCount = (ev.api_error ?? 0) + (ev.admin_error ?? 0);
      const emailFailedCount = (ev.email_failed ?? 0) + (emailFailedLeadsMap.get(t.id) ?? 0);
      const paymentFailedCount = (ev.payment_failed ?? 0) + (payFailedMap.get(t.id) ?? 0);
      const paymentPaidCount = (ev.payment_succeeded ?? 0) + (payPaidMap.get(t.id) ?? 0);
      const calculatorFailedCount = ev.calculator_quote_failed ?? 0;
      const pricingSuspect = detectPricingSuspect(t.settings);

      const plan = computeSitePlan({
        tenantId: t.id,
        active: t.active,
        settingsPresent: t.settings != null,
        stripeConnected,
        stripeOk,
        audit,
        lastActivityAt,
        eventCounts: ev,
        emailFailedCount,
        paymentFailedCount,
        paymentPaidCount,
        calculatorFailedCount,
        errorsCount,
        pricingSuspect,
      });

      const next = plan.actions.find((x) => x.statut === "a_faire");
      if (next) {
        priorityActions.push({
          priority: plan.priority,
          tenantId: t.id,
          siteName: String(siteName),
          statusFine: plan.fineLabel,
          problem: plan.reasons[0] ?? "À surveiller",
          action: next.action,
          why: next.pourquoi,
          lastActivityAt,
        });
        alerts.push({
          severity: plan.priority === "critique" ? "critique" : plan.priority === "important" ? "warning" : "info",
          tenantId: t.id,
          siteName: String(siteName),
          reason: next.action,
          detail: next.pourquoi,
          actionSuggested: next.action,
          lastActivityAt,
        });
      }

      return {
        tenantId: t.id,
        name: String(siteName),
        active: t.active,
        status: plan.fineStatus,
        statusLabel: plan.fineLabel,
        priority: plan.priority,
        readinessScore: audit.readinessScore,
        problems,
        lastActivityAt,
        stripe: { connected: stripeConnected, ok: stripeOk, onboardingStatus: t.stripeOnboardingStatus },
        nextAction: plan.nextAction,
      };
    });

    const sortedAlerts = alerts
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
      .slice(0, 200);

    const summary = {
      critique: sortedAlerts.filter((a) => a.severity === "critique").length,
      warning: sortedAlerts.filter((a) => a.severity === "warning").length,
      info: sortedAlerts.filter((a) => a.severity === "info").length,
    };

    // Sites “à surveiller” (top 15) : erreurs + warnings + inactifs
    const sitesToWatch = sites
      .filter((s) => s.status !== "ok")
      .sort((a, b) => {
        const rank = (x: string) => (x === "erreur" ? 4 : x === "risque" ? 3 : x === "incomplet" ? 2 : x === "a_configurer" ? 1 : 0);
        return rank(String(b.status)) - rank(String(a.status));
      })
      .slice(0, 30);

    // Activité récente “importante” : events filtrés (limité)
    const recentEvents = await prisma.platformEvent.findMany({
      where: {
        createdAt: { gte: fromDate, lte: to },
        type: { in: ["payment_succeeded", "payment_failed", "calculator_quote_failed", "api_error", "admin_error", "email_failed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    res.status(200).json({
      success: true,
      data: {
        range,
        summary,
        sitesToWatch,
        alerts: sortedAlerts,
        priorityActions: priorityActions
          .sort((a, b) => {
            const r = (p: string) => (p === "critique" ? 4 : p === "important" ? 3 : p === "moyen" ? 2 : 1);
            return r(b.priority) - r(a.priority);
          })
          .slice(0, 30),
        recentEvents,
      },
    });
  } catch (e) {
    next(e);
  }
}

