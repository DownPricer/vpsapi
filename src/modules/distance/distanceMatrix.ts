import { trackPlatformEvent } from "../../platform/telemetry.service";

export interface DistanceResult {
  km: number;
  duree: number;
}

export type DistanceUsageContext = {
  tenantId?: string | null;
  observedDomain?: string | null;
  origin?: string | null;
  path?: string | null;
};

export async function getDistancesBatch(
  apiKey: string,
  origins: string[],
  destinations: string[],
  usageContext?: DistanceUsageContext
): Promise<Record<string, DistanceResult>> {
  const o = origins.map((x) => encodeURIComponent(x)).join("|");
  const d = destinations.map((x) => encodeURIComponent(x)).join("|");
  const url = `https://api.distancematrix.ai/maps/api/distancematrix/json?origins=${o}&destinations=${d}&travelMode=DRIVING&departure_time=now&key=${apiKey}`;
  const startedAt = Date.now();
  let statusForEvent = "UNKNOWN";
  try {
    const resp = await fetch(url, { method: "GET" });
    const data = (await resp.json()) as {
      status: string;
      error_message?: string;
      rows?: Array<{
        elements: Array<{
          status: string;
          distance?: { value: number };
          duration?: { value: number };
          duration_in_traffic?: { value: number };
        }>;
      }>;
    };
    statusForEvent = data.status;
    if (data.status !== "OK") {
      throw new Error(`DistanceMatrix: ${data.error_message || data.status}`);
    }
    void trackPlatformEvent({
      tenantId: usageContext?.tenantId ?? null,
      observedDomain: usageContext?.observedDomain ?? null,
      origin: usageContext?.origin ?? null,
      type: "api_usage_distance_matrix",
      category: "api_usage",
      path: usageContext?.path ?? "/api/calculer-tarif",
      metadata: {
        provider: "distancematrix.ai",
        endpoint: "maps/api/distancematrix/json",
        success: true,
        status: data.status,
        durationMs: Date.now() - startedAt,
        originCount: origins.length,
        destinationCount: destinations.length,
        billableUnit: origins.length * destinations.length,
      },
    });
  const out: Record<string, DistanceResult> = {};
  if (data.rows) {
    for (let i = 0; i < data.rows.length; i++) {
      for (let j = 0; j < data.rows[i].elements.length; j++) {
        const el = data.rows[i].elements[j];
        const key = `${origins[i]}->${destinations[j]}`;
        out[key] =
          el.status === "OK"
            ? {
                km: (el.distance?.value ?? 0) / 1000,
                duree: Math.round(
                  el.duration_in_traffic?.value ?? el.duration?.value ?? 0
                ),
              }
            : { km: 0, duree: 0 };
      }
    }
  }
  return out;
  } catch (e) {
    void trackPlatformEvent({
      tenantId: usageContext?.tenantId ?? null,
      observedDomain: usageContext?.observedDomain ?? null,
      origin: usageContext?.origin ?? null,
      type: "api_usage_distance_matrix",
      category: "api_usage",
      path: usageContext?.path ?? "/api/calculer-tarif",
      metadata: {
        provider: "distancematrix.ai",
        endpoint: "maps/api/distancematrix/json",
        success: false,
        status: statusForEvent,
        error: e instanceof Error ? e.message.slice(0, 160) : "DistanceMatrix error",
        durationMs: Date.now() - startedAt,
        originCount: origins.length,
        destinationCount: destinations.length,
        billableUnit: origins.length * destinations.length,
      },
    });
    throw e;
  }
}

export async function getDistancesWithFallback(
  apiKey: string,
  origins: string[],
  destinations: string[],
  usageContext?: DistanceUsageContext
): Promise<Record<string, DistanceResult>> {
  try {
    return await getDistancesBatch(apiKey, origins, destinations, usageContext);
  } catch (e) {
    console.error("[DistanceMatrix] échec:", (e as Error).message);
    const out: Record<string, DistanceResult> = {};
    for (const o of origins) {
      for (const d of destinations) {
        out[`${o}->${d}`] = { km: 0, duree: 0 };
      }
    }
    return out;
  }
}
