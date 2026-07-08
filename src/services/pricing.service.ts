import { requireDistanceMatrixKey } from "../config/env";
import type { TenantConfig } from "../types/tenant";
import type { DistanceUsageContext } from "../modules/distance/distanceMatrix";
import {
  calculerDistances,
  calculerTarif,
  normalizeTypeService,
  resolvePricingEngineForRequest,
  serializeTarifResult,
} from "../modules/pricing";
import {
  buildPricingDebugBreakdown,
  type PricingDebugBreakdown,
} from "../modules/pricing/pricingDebugBreakdown";
import type { Distances, TarifResult } from "../modules/pricing/types";

export type ServiceTypeKey = "classique" | "aeroport" | "mad-evenementiel";

export function resolveServiceTypeKey(body: Record<string, unknown>): ServiceTypeKey | null {
  const ts = normalizeTypeService(
    (body?.general as Record<string, unknown>)?.TypeService as string
  );
  if (ts === "Trajet Classique") return "classique";
  if (ts === "Transfert Aéroport") return "aeroport";
  if (ts === "MAD Evenementiel") return "mad-evenementiel";
  return null;
}

/**
 * Pipeline distance + tarif + créneaux (sans sérialisation HTTP).
 * Réutilisable par devis / réservation sans dupliquer la logique métier.
 */
export async function runPricingPipeline(
  tenant: TenantConfig,
  body: Record<string, unknown>,
  opts?: { includeDebug?: boolean; usageContext?: DistanceUsageContext }
): Promise<{
  typeKey: ServiceTypeKey;
  distances: Distances;
  result: TarifResult;
  engine: TenantConfig["pricingEngine"];
  pricingConfigSource: "tenant_engine" | "payload_pricing_config";
  pricingConfigVersion?: string;
  pricingDebug?: PricingDebugBreakdown;
}> {
  const apiKey = requireDistanceMatrixKey();
  const typeKey = resolveServiceTypeKey(body);
  if (!typeKey) {
    const raw = (body?.general as Record<string, unknown>)?.TypeService;
    throw new Error(`Type de service inconnu : ${String(raw ?? "")}`);
  }
  const resolvedPricing = resolvePricingEngineForRequest(tenant, body);
  const engine = resolvedPricing.engine;
  const distances = await calculerDistances(apiKey, body, engine, opts?.usageContext);
  const result = await calculerTarif(typeKey, body, distances, engine);
  let pricingDebug: PricingDebugBreakdown | undefined;
  if (opts?.includeDebug) {
    pricingDebug = buildPricingDebugBreakdown({
      tenantId: tenant.id,
      typeKey,
      body,
      engine,
      distances,
      result,
    });
  }
  return {
    typeKey,
    distances,
    result,
    engine,
    pricingConfigSource: resolvedPricing.source,
    pricingConfigVersion: resolvedPricing.pricingConfigVersion,
    pricingDebug,
  };
}

export class PricingService {
  /**
   * Calcul tarif complet (distances Distance Matrix + tarif + créneaux).
   * @throws Error si type de service inconnu ou clé API manquante (avant appel réseau).
   */
  async computeTariffForRequest(
    tenant: TenantConfig,
    body: Record<string, unknown>,
    opts?: { includeDebug?: boolean; usageContext?: DistanceUsageContext }
  ): Promise<{
    serialized: Record<string, unknown>;
    pricingDebug?: PricingDebugBreakdown;
    pricingConfigSource: "tenant_engine" | "payload_pricing_config";
    pricingConfigVersion?: string;
  }> {
    const { result, pricingDebug, pricingConfigSource, pricingConfigVersion } = await runPricingPipeline(tenant, body, opts);
    return { serialized: serializeTarifResult(result), pricingDebug, pricingConfigSource, pricingConfigVersion };
  }
}
