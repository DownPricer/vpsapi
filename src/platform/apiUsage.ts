import { prisma } from "../db/prisma";
import type { RangeKey } from "./platformQueries";
import { rangeToDates } from "./platformQueries";

export const API_USAGE_EVENT_TYPES = [
  "calculator_quote_success",
  "calculator_quote_failed",
  "api_usage_route_calculation",
  "api_usage_distance_matrix",
  "api_usage_geocode",
  "api_usage_autocomplete",
  "quote_request_created",
  "booking_created",
  "payment_checkout_created",
  "payment_succeeded",
  "payment_failed",
  "email_sent",
  "email_failed",
  "api_error",
] as const;

type UsageCounts = Record<string, number>;

export type ApiUsageSummary = {
  calculations: number;
  calculationSuccess: number;
  calculationFailed: number;
  routeCalculations: number;
  distanceCalls: number;
  geocodeCalls: number;
  autocompleteCalls: number;
  businessApiCalls: number;
  quoteRequests: number;
  reservations: number;
  payments: number;
  emails: number;
  apiErrors: number;
  estimatedCostCents: number | null;
  costConfigured: boolean;
};

function optionalCostCents(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function summarizeUsageCounts(counts: UsageCounts): ApiUsageSummary {
  const calculationSuccess = counts.calculator_quote_success ?? 0;
  const calculationFailed = counts.calculator_quote_failed ?? 0;
  const routeCalculations = counts.api_usage_route_calculation ?? 0;
  const distanceCalls = counts.api_usage_distance_matrix ?? 0;
  const geocodeCalls = counts.api_usage_geocode ?? 0;
  const autocompleteCalls = counts.api_usage_autocomplete ?? 0;
  const quoteRequests = counts.quote_request_created ?? 0;
  const reservations = counts.booking_created ?? 0;
  const payments =
    (counts.payment_checkout_created ?? 0) +
    (counts.payment_succeeded ?? 0) +
    (counts.payment_failed ?? 0);
  const emails = (counts.email_sent ?? 0) + (counts.email_failed ?? 0);
  const businessApiCalls = quoteRequests + reservations + payments + emails;
  const apiErrors = (counts.api_error ?? 0) + calculationFailed;

  const distanceCost = optionalCostCents("GOOGLE_DISTANCE_MATRIX_COST_CENTS_PER_CALL");
  const geocodeCost = optionalCostCents("GOOGLE_GEOCODE_COST_CENTS_PER_CALL");
  const autocompleteCost = optionalCostCents("GOOGLE_AUTOCOMPLETE_COST_CENTS_PER_CALL");
  const costConfigured = distanceCost !== null || geocodeCost !== null || autocompleteCost !== null;
  const estimatedCostCents = costConfigured
    ? Math.round(
        distanceCalls * (distanceCost ?? 0) +
          geocodeCalls * (geocodeCost ?? 0) +
          autocompleteCalls * (autocompleteCost ?? 0)
      )
    : null;

  return {
    calculations: calculationSuccess + calculationFailed,
    calculationSuccess,
    calculationFailed,
    routeCalculations,
    distanceCalls,
    geocodeCalls,
    autocompleteCalls,
    businessApiCalls,
    quoteRequests,
    reservations,
    payments,
    emails,
    apiErrors,
    estimatedCostCents,
    costConfigured,
  };
}

export async function getUsageSummariesByTenant(
  tenantIds: string[],
  range: RangeKey
): Promise<Map<string, ApiUsageSummary>> {
  const { from, to } = rangeToDates(range);
  if (tenantIds.length === 0) return new Map();
  const rows = await prisma.platformEvent.groupBy({
    by: ["tenantId", "type"],
    where: {
      tenantId: { in: tenantIds },
      type: { in: [...API_USAGE_EVENT_TYPES] },
      ...(from ? { createdAt: { gte: from, lte: to } } : {}),
    },
    _count: { _all: true },
  });
  const countsByTenant = new Map<string, UsageCounts>();
  for (const row of rows) {
    if (!row.tenantId) continue;
    const counts = countsByTenant.get(row.tenantId) ?? {};
    counts[row.type] = (counts[row.type] ?? 0) + row._count._all;
    countsByTenant.set(row.tenantId, counts);
  }
  return new Map(tenantIds.map((tenantId) => [tenantId, summarizeUsageCounts(countsByTenant.get(tenantId) ?? {})]));
}

export async function getUsagePeriodsByTenant(tenantIds: string[]): Promise<Map<string, Record<"7d" | "30d" | "90d" | "all", ApiUsageSummary>>> {
  const periods = ["7d", "30d", "90d", "all"] as const;
  const result = new Map<string, Record<"7d" | "30d" | "90d" | "all", ApiUsageSummary>>();
  const maps = await Promise.all(periods.map((range) => getUsageSummariesByTenant(tenantIds, range)));
  for (const tenantId of tenantIds) {
    result.set(tenantId, {
      "7d": maps[0].get(tenantId) ?? summarizeUsageCounts({}),
      "30d": maps[1].get(tenantId) ?? summarizeUsageCounts({}),
      "90d": maps[2].get(tenantId) ?? summarizeUsageCounts({}),
      all: maps[3].get(tenantId) ?? summarizeUsageCounts({}),
    });
  }
  return result;
}

export async function getPlatformUsageSummary(range: RangeKey): Promise<ApiUsageSummary> {
  const { from, to } = rangeToDates(range);
  const rows = await prisma.platformEvent.groupBy({
    by: ["type"],
    where: {
      type: { in: [...API_USAGE_EVENT_TYPES] },
      ...(from ? { createdAt: { gte: from, lte: to } } : {}),
    },
    _count: { _all: true },
  });
  const counts: UsageCounts = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + row._count._all;
  return summarizeUsageCounts(counts);
}
