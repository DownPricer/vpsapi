import type { TenantPricingEngineConfig } from "../../modules/pricing/engineTypes";
import type { TenantConfigFile } from "../../types/tenant";
import { parsePricingEngineJson } from "./engineSchema";
import defaultEngineJson from "./engines/default.engine.json";
import clientDemoEngineJson from "./engines/client-demo.engine.json";

/**
 * Registre des fichiers moteur (`*.engine.json`).
 * Pour ajouter un moteur : 1) créer `engines/<ref>.engine.json`
 * 2) l’importer ici et l’ajouter à `ENGINE_JSON_BY_REF`.
 */
const ENGINE_JSON_BY_REF: Record<string, unknown> = {
  default: defaultEngineJson,
  "client-demo": clientDemoEngineJson,
};

export function listEngineRefs(): string[] {
  return Object.keys(ENGINE_JSON_BY_REF);
}

/**
 * Charge et valide un moteur, puis fixe l’adresse de dépôt **par défaut** depuis le fichier tenant :
 * `depotAddress` sert de repli si le corps de requête n’inclut pas `vtcBaseAddress`
 * (le front envoie l’adresse de base depuis les tenant settings white-label).
 */
export function buildPricingEngineForTenant(file: TenantConfigFile): TenantPricingEngineConfig {
  const raw = ENGINE_JSON_BY_REF[file.engineRef];
  if (raw === undefined) {
    throw new Error(
      `Moteur de tarification inconnu : "${file.engineRef}". Moteurs connus : ${listEngineRefs().join(", ")}`
    );
  }
  const engine = parsePricingEngineJson(raw);
  const depot = file.baseAddress.label.trim();
  if (!depot) {
    throw new Error(`Locataire ${file.id} : baseAddress.label est requis pour le calcul d’approche.`);
  }
  return {
    ...engine,
    depotAddress: depot,
  };
}
