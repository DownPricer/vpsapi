import type { NextFunction, Request, Response } from "express";
import { DateTime } from "luxon";
import { prisma } from "../db/prisma";
import { parseRangeKey, rangeToDates, type RangeKey } from "./platformQueries";

type DayKey = string; // YYYY-MM-DD

function toDayKey(d: Date): DayKey {
  return DateTime.fromJSDate(d, { zone: "utc" }).toFormat("yyyy-LL-dd");
}

function listDays(from: Date, to: Date): DayKey[] {
  const start = DateTime.fromJSDate(from, { zone: "utc" }).startOf("day");
  const end = DateTime.fromJSDate(to, { zone: "utc" }).startOf("day");
  const days: DayKey[] = [];
  let cur = start;
  // inclure end si même jour ? on prend jusqu’à end inclus (rangeToDates donne "to" = now)
  while (cur <= end && days.length < 400) {
    days.push(cur.toFormat("yyyy-LL-dd"));
    cur = cur.plus({ days: 1 });
  }
  return days;
}

function clampRangeForCharts(range: RangeKey): RangeKey {
  if (range === "all") return "90d";
  return range;
}

async function queryEventCountsByDay(params: { from: Date; to: Date; tenantId?: string | null }): Promise<Array<{ day: string; type: string; cnt: number }>> {
  const rows = await prisma.$queryRaw<Array<{ day: string; type: string; cnt: bigint }>>`
    SELECT
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
      "type" AS type,
      count(*)::bigint AS cnt
    FROM "PlatformEvent"
    WHERE "createdAt" >= ${params.from} AND "createdAt" <= ${params.to}
      AND (${params.tenantId ?? null}::text IS NULL OR "tenantId" = ${params.tenantId ?? null})
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({ day: r.day, type: r.type, cnt: Number(r.cnt) }));
}

async function queryRevenueByDay(params: { from: Date; to: Date; tenantId?: string | null }): Promise<Array<{ day: string; amount: number; fee: number }>> {
  const rows = await prisma.$queryRaw<Array<{ day: string; amount: bigint; fee: bigint }>>`
    SELECT
      to_char(date_trunc('day', "paidAt"), 'YYYY-MM-DD') AS day,
      COALESCE(sum("amount"), 0)::bigint AS amount,
      COALESCE(sum("applicationFeeAmount"), 0)::bigint AS fee
    FROM "Payment"
    WHERE "status" = 'PAID'
      AND "paidAt" IS NOT NULL
      AND "paidAt" >= ${params.from} AND "paidAt" <= ${params.to}
      AND (${params.tenantId ?? null}::text IS NULL OR "tenantId" = ${params.tenantId ?? null})
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({ day: r.day, amount: Number(r.amount), fee: Number(r.fee) }));
}

async function queryReservationsByDay(params: { from: Date; to: Date; tenantId?: string | null }): Promise<Array<{ day: string; cnt: number }>> {
  const rows = await prisma.$queryRaw<Array<{ day: string; cnt: bigint }>>`
    SELECT
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
      count(*)::bigint AS cnt
    FROM "LeadRequest"
    WHERE "kind" = 'reservation'
      AND "createdAt" >= ${params.from} AND "createdAt" <= ${params.to}
      AND (${params.tenantId ?? null}::text IS NULL OR "tenantId" = ${params.tenantId ?? null})
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({ day: r.day, cnt: Number(r.cnt) }));
}

async function queryServiceTypeBreakdown(params: { from: Date; to: Date; tenantId?: string | null }): Promise<Array<{ key: string; cnt: number }>> {
  const rows = await prisma.$queryRaw<Array<{ key: string | null; cnt: bigint }>>`
    SELECT
      NULLIF(("metadata"->>'serviceType'), '') AS key,
      count(*)::bigint AS cnt
    FROM "PlatformEvent"
    WHERE "type" = 'calculator_quote_success'
      AND "createdAt" >= ${params.from} AND "createdAt" <= ${params.to}
      AND (${params.tenantId ?? null}::text IS NULL OR "tenantId" = ${params.tenantId ?? null})
    GROUP BY 1
    ORDER BY 2 DESC
  `;
  return rows
    .map((r) => ({ key: (r.key ?? "unknown").slice(0, 40), cnt: Number(r.cnt) }))
    .filter((r) => r.cnt > 0)
    .slice(0, 10);
}

export async function getPlatformOverviewCharts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawRange = parseRangeKey(req.query.range, "30d");
  const range = clampRangeForCharts(rawRange);
  const { from, to } = rangeToDates(range);
  const fromDate = from ?? DateTime.utc().minus({ days: 90 }).toJSDate();
  const days = listDays(fromDate, to);

  try {
    const [eventRows, revenueRows, reservationRows, serviceTypes] = await Promise.all([
      queryEventCountsByDay({ from: fromDate, to }),
      queryRevenueByDay({ from: fromDate, to }),
      queryReservationsByDay({ from: fromDate, to }),
      queryServiceTypeBreakdown({ from: fromDate, to }),
    ]);

    const byDayType = new Map<string, Map<string, number>>();
    for (const r of eventRows) {
      const m = byDayType.get(r.day) ?? new Map<string, number>();
      m.set(r.type, (m.get(r.type) ?? 0) + r.cnt);
      byDayType.set(r.day, m);
    }
    const revByDay = new Map<string, { amount: number; fee: number }>(revenueRows.map((r) => [r.day, { amount: r.amount, fee: r.fee }]));
    const resByDay = new Map<string, number>(reservationRows.map((r) => [r.day, r.cnt]));

    const series = days.map((d) => {
      const m = byDayType.get(d);
      const rev = revByDay.get(d) ?? { amount: 0, fee: 0 };
      return {
        day: d,
        pageViews: m?.get("page_view") ?? 0,
        calculatorOpened: m?.get("calculator_opened") ?? 0,
        calculatorStarted: m?.get("calculator_started") ?? 0,
        calculatorQuoteDisplayed: m?.get("calculator_quote_displayed") ?? 0,
        calculatorQuotes: (m?.get("calculator_quote_success") ?? 0) + (m?.get("calculator_quote_failed") ?? 0),
        reservations: resByDay.get(d) ?? (m?.get("booking_created") ?? 0),
        payments: (m?.get("payment_succeeded") ?? 0) + (m?.get("payment_failed") ?? 0),
        emails: (m?.get("email_sent") ?? 0) + (m?.get("email_failed") ?? 0),
        errors: (m?.get("api_error") ?? 0) + (m?.get("admin_error") ?? 0),
        revenuePaidCents: rev.amount,
        platformFeesCents: rev.fee,
      };
    });

    // Top 5 sites (CA payé)
    const top = await prisma.payment.groupBy({
      by: ["tenantId"],
      where: { status: "PAID", paidAt: { gte: fromDate, lte: to } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    });
    const topTenantIds = top.map((t) => t.tenantId);
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: topTenantIds } },
      select: { id: true, name: true, settings: true },
    });
    const nameMap = new Map<string, string>();
    for (const t of tenants) {
      const s = t.settings as any;
      const n =
        (s && typeof s === "object" && s.branding && typeof s.branding === "object" ? (s.branding as any).name : null) ||
        t.name;
      nameMap.set(t.id, String(n ?? t.name));
    }
    const topSites = top.map((r) => ({
      tenantId: r.tenantId,
      name: nameMap.get(r.tenantId) ?? r.tenantId,
      revenuePaidCents: r._sum.amount ?? 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        range,
        series,
        topSites,
        serviceTypes,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPlatformSiteCharts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.params.tenantId ?? "").trim();
  const rawRange = parseRangeKey(req.query.range, "30d");
  const range = clampRangeForCharts(rawRange);
  const { from, to } = rangeToDates(range);
  const fromDate = from ?? DateTime.utc().minus({ days: 90 }).toJSDate();
  const days = listDays(fromDate, to);

  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "tenantId requis." } });
    return;
  }

  try {
    const [eventRows, revenueRows, reservationRows, serviceTypes] = await Promise.all([
      queryEventCountsByDay({ from: fromDate, to, tenantId }),
      queryRevenueByDay({ from: fromDate, to, tenantId }),
      queryReservationsByDay({ from: fromDate, to, tenantId }),
      queryServiceTypeBreakdown({ from: fromDate, to, tenantId }),
    ]);

    const byDayType = new Map<string, Map<string, number>>();
    for (const r of eventRows) {
      const m = byDayType.get(r.day) ?? new Map<string, number>();
      m.set(r.type, (m.get(r.type) ?? 0) + r.cnt);
      byDayType.set(r.day, m);
    }
    const revByDay = new Map<string, { amount: number; fee: number }>(revenueRows.map((r) => [r.day, { amount: r.amount, fee: r.fee }]));
    const resByDay = new Map<string, number>(reservationRows.map((r) => [r.day, r.cnt]));

    const series = days.map((d) => {
      const m = byDayType.get(d);
      const rev = revByDay.get(d) ?? { amount: 0, fee: 0 };
      return {
        day: d,
        pageViews: m?.get("page_view") ?? 0,
        calculatorOpened: m?.get("calculator_opened") ?? 0,
        calculatorStarted: m?.get("calculator_started") ?? 0,
        calculatorQuoteDisplayed: m?.get("calculator_quote_displayed") ?? 0,
        calculatorQuotes: (m?.get("calculator_quote_success") ?? 0) + (m?.get("calculator_quote_failed") ?? 0),
        demands: (m?.get("quote_request_created") ?? 0) + (m?.get("booking_created") ?? 0),
        reservations: resByDay.get(d) ?? (m?.get("booking_created") ?? 0),
        payments: (m?.get("payment_succeeded") ?? 0) + (m?.get("payment_failed") ?? 0),
        emails: (m?.get("email_sent") ?? 0) + (m?.get("email_failed") ?? 0),
        errors: (m?.get("api_error") ?? 0) + (m?.get("admin_error") ?? 0),
        revenuePaidCents: rev.amount,
        platformFeesCents: rev.fee,
      };
    });

    // Funnel simple (range) : page_view (si dispo) -> quotes -> demandes -> réservations -> paiements
    const funnel = {
      pageViews: eventRows.filter((r) => r.type === "page_view").reduce((a, r) => a + r.cnt, 0),
      calculatorOpened: eventRows.filter((r) => r.type === "calculator_opened").reduce((a, r) => a + r.cnt, 0),
      calculatorStarted: eventRows.filter((r) => r.type === "calculator_started").reduce((a, r) => a + r.cnt, 0),
      quoteDisplayed: eventRows.filter((r) => r.type === "calculator_quote_displayed").reduce((a, r) => a + r.cnt, 0),
      quotesApi: eventRows.filter((r) => r.type === "calculator_quote_success" || r.type === "calculator_quote_failed").reduce((a, r) => a + r.cnt, 0),
      demands: eventRows
        .filter((r) => r.type === "quote_request_created" || r.type === "booking_created")
        .reduce((a, r) => a + r.cnt, 0),
      reservations: reservationRows.reduce((a, r) => a + r.cnt, 0),
      payments: eventRows
        .filter((r) => r.type === "payment_succeeded" || r.type === "payment_failed")
        .reduce((a, r) => a + r.cnt, 0),
    };

    res.status(200).json({
      success: true,
      data: {
        tenantId,
        range,
        series,
        serviceTypes,
        funnel,
      },
    });
  } catch (e) {
    next(e);
  }
}

