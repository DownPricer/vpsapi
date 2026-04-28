import { requireDistanceMatrixKey } from "../config/env";
import type { TenantConfig } from "../types/tenant";
import {
  calculerDistances,
  calculerTarif,
  normalizeTypeService,
  serializeTarifResult,
} from "../modules/pricing";
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
  body: Record<string, unknown>
): Promise<{ typeKey: ServiceTypeKey; distances: Distances; result: TarifResult }> {
  const apiKey = requireDistanceMatrixKey();
  const typeKey = resolveServiceTypeKey(body);
  if (!typeKey) {
    const raw = (body?.general as Record<string, unknown>)?.TypeService;
    throw new Error(`Type de service inconnu : ${String(raw ?? "")}`);
  }
  const engine = tenant.pricingEngine;
  const distances = await calculerDistances(apiKey, body, engine);
  const result = await calculerTarif(typeKey, body, distances, engine);
  return { typeKey, distances, result };
}

export class PricingService {
  /**
   * Calcul tarif complet (distances Distance Matrix + tarif + créneaux).
   * @throws Error si type de service inconnu ou clé API manquante (avant appel réseau).
   */
  async computeTariffForRequest(
    tenant: TenantConfig,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const { result } = await runPricingPipeline(tenant, body);
    return serializeTarifResult(result);
  }
}
