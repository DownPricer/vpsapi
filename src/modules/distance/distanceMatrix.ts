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

export type DistanceUnavailableCause = "ADDRESS_NOT_FOUND" | "PROVIDER_ERROR";

/** Distance Matrix indisponible ou adresse non résolue — ne jamais inventer 0 km. */
export class DistanceUnavailableError extends Error {
  readonly code = "DISTANCE_UNAVAILABLE" as const;
  readonly causeCode: DistanceUnavailableCause;
  readonly httpStatus: 422 | 503;

  constructor(causeCode: DistanceUnavailableCause, message: string) {
    super(message);
    this.name = "DistanceUnavailableError";
    this.causeCode = causeCode;
    this.httpStatus = causeCode === "ADDRESS_NOT_FOUND" ? 422 : 503;
  }
}

const MSG_ADDRESS =
  "Impossible de calculer le trajet : une adresse n’a pas pu être trouvée. Vérifiez le départ et la destination.";
const MSG_PROVIDER =
  "Le calcul de distance est temporairement indisponible. Réessayez dans quelques instants.";

function elementCause(status: string): DistanceUnavailableCause {
  if (status === "NOT_FOUND" || status === "ZERO_RESULTS") return "ADDRESS_NOT_FOUND";
  return "PROVIDER_ERROR";
}

function userMessage(cause: DistanceUnavailableCause): string {
  return cause === "ADDRESS_NOT_FOUND" ? MSG_ADDRESS : MSG_PROVIDER;
}

async function emitDistanceUsageEvent(
  usageContext: DistanceUsageContext | undefined,
  metadata: Record<string, unknown>
): Promise<void> {
  await trackPlatformEvent({
    tenantId: usageContext?.tenantId ?? null,
    observedDomain: usageContext?.observedDomain ?? null,
    origin: usageContext?.origin ?? null,
    type: "api_usage_distance_matrix",
    category: "api_usage",
    path: usageContext?.path ?? "/api/calculer-tarif",
    metadata,
  });
}

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
    let resp: Response;
    try {
      resp = await fetch(url, { method: "GET" });
    } catch {
      throw new DistanceUnavailableError("PROVIDER_ERROR", userMessage("PROVIDER_ERROR"));
    }
    if (!resp.ok) {
      statusForEvent = `HTTP_${resp.status}`;
      throw new DistanceUnavailableError("PROVIDER_ERROR", userMessage("PROVIDER_ERROR"));
    }
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
      const cause: DistanceUnavailableCause =
        data.status === "NOT_FOUND" || data.status === "ZERO_RESULTS"
          ? "ADDRESS_NOT_FOUND"
          : "PROVIDER_ERROR";
      throw new DistanceUnavailableError(cause, userMessage(cause));
    }
    await emitDistanceUsageEvent(usageContext, {
      provider: "distancematrix.ai",
      endpoint: "maps/api/distancematrix/json",
      success: true,
      status: data.status,
      durationMs: Date.now() - startedAt,
      originCount: origins.length,
      destinationCount: destinations.length,
      billableUnit: origins.length * destinations.length,
    });
    const out: Record<string, DistanceResult> = {};
    if (data.rows) {
      for (let i = 0; i < data.rows.length; i++) {
        for (let j = 0; j < data.rows[i].elements.length; j++) {
          const el = data.rows[i].elements[j];
          const key = `${origins[i]}->${destinations[j]}`;
          const samePlace = origins[i].trim() === destinations[j].trim();
          if (el.status === "OK") {
            out[key] = {
              km: (el.distance?.value ?? 0) / 1000,
              duree: Math.round(
                el.duration_in_traffic?.value ?? el.duration?.value ?? 0
              ),
            };
          } else if (samePlace) {
            // Trajet origine = destination : 0 km légitime même si le fournisseur est ambigu.
            out[key] = { km: 0, duree: 0 };
          } else {
            const cause = elementCause(el.status);
            throw new DistanceUnavailableError(cause, userMessage(cause));
          }
        }
      }
    }
    return out;
  } catch (e) {
    void emitDistanceUsageEvent(usageContext, {
      provider: "distancematrix.ai",
      endpoint: "maps/api/distancematrix/json",
      success: false,
      status: statusForEvent,
      error: e instanceof Error ? e.message.slice(0, 160) : "DistanceMatrix error",
      durationMs: Date.now() - startedAt,
      originCount: origins.length,
      destinationCount: destinations.length,
      billableUnit: origins.length * destinations.length,
      causeCode: e instanceof DistanceUnavailableError ? e.causeCode : undefined,
    });
    if (e instanceof DistanceUnavailableError) throw e;
    throw new DistanceUnavailableError("PROVIDER_ERROR", userMessage("PROVIDER_ERROR"));
  }
}

/**
 * Appelle Distance Matrix. En cas d’échec, propage l’erreur (jamais de 0 km inventé).
 * Le nom historique « WithFallback » est conservé pour les appelants existants.
 */
export async function getDistancesWithFallback(
  apiKey: string,
  origins: string[],
  destinations: string[],
  usageContext?: DistanceUsageContext
): Promise<Record<string, DistanceResult>> {
  try {
    return await getDistancesBatch(apiKey, origins, destinations, usageContext);
  } catch (e) {
    console.error(
      "[DistanceMatrix] échec:",
      e instanceof DistanceUnavailableError
        ? `${e.causeCode}: ${e.message}`
        : (e as Error).message
    );
    throw e;
  }
}
