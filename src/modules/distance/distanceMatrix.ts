export interface DistanceResult {
  km: number;
  duree: number;
}

export async function getDistancesBatch(
  apiKey: string,
  origins: string[],
  destinations: string[]
): Promise<Record<string, DistanceResult>> {
  const o = origins.map((x) => encodeURIComponent(x)).join("|");
  const d = destinations.map((x) => encodeURIComponent(x)).join("|");
  const url = `https://api.distancematrix.ai/maps/api/distancematrix/json?origins=${o}&destinations=${d}&travelMode=DRIVING&departure_time=now&key=${apiKey}`;
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
  if (data.status !== "OK") {
    throw new Error(`DistanceMatrix: ${data.error_message || data.status}`);
  }
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
}

export async function getDistancesWithFallback(
  apiKey: string,
  origins: string[],
  destinations: string[]
): Promise<Record<string, DistanceResult>> {
  try {
    return await getDistancesBatch(apiKey, origins, destinations);
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
