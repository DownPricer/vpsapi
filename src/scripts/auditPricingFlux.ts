/**
 * Audit flux : pricingConfig (API) + calcul réel (Distance Matrix si clé présente).
 * Usage : `npx tsx src/scripts/auditPricingFlux.ts` (depuis vtc-core-api, avec .env).
 */
import "dotenv/config";
import { getTenantConfig } from "../config/tenants/registry";
import { buildPricingDebugBreakdown } from "../modules/pricing/pricingDebugBreakdown";
import { resolveServiceTypeKey } from "../services/pricing.service";
import {
  calculerDistances,
  calculerTarif,
  mapEngineToPricingConfig,
  normalizeTypeService,
  resolvePricingEngineForRequest,
  validatePricingConfigPayload,
  MAX_ARRAY_ITEMS_RULES,
} from "../modules/pricing";

function assertClassicTripShape(pc: Record<string, unknown>) {
  const ct = pc.classicTrip;
  if (Array.isArray(ct)) {
    throw new Error(
      `BUG: classicTrip est un tableau (longueur ${ct.length}) — l’API attend un objet { zoneBands, distanceRulesOneWay, ... }.`
    );
  }
  if (!ct || typeof ct !== "object") {
    throw new Error("BUG: classicTrip absent ou non-objet.");
  }
  const o = ct as Record<string, unknown>;
  const zb = o.zoneBands;
  const ow = o.distanceRulesOneWay;
  const rt = o.distanceRulesRoundTrip;
  if (Array.isArray(zb) && zb.length > MAX_ARRAY_ITEMS_RULES) {
    throw new Error(`classicTrip.zoneBands dépasse ${MAX_ARRAY_ITEMS_RULES} (reçu ${zb.length}).`);
  }
  if (Array.isArray(ow) && ow.length > MAX_ARRAY_ITEMS_RULES) {
    throw new Error(`classicTrip.distanceRulesOneWay dépasse ${MAX_ARRAY_ITEMS_RULES} (reçu ${ow.length}).`);
  }
  if (Array.isArray(rt) && rt.length > MAX_ARRAY_ITEMS_RULES) {
    throw new Error(`classicTrip.distanceRulesRoundTrip dépasse ${MAX_ARRAY_ITEMS_RULES} (reçu ${rt.length}).`);
  }
}

function buildPayloadPricingConfig(vtcBase: string) {
  const tenant = getTenantConfig("default");
  if (!tenant) throw new Error("Tenant default introuvable.");
  return mapEngineToPricingConfig(tenant.pricingEngine, {
    vtcBaseAddress: vtcBase,
    timezone: tenant.pricingEngine.timezone,
    currency: "EUR",
  });
}

type Scenario = {
  id: string;
  vtcBase: string;
  body: Record<string, unknown>;
};

const scenarios: Scenario[] = [
  {
    id: "Satillieu → Annonay (aller simple, classique)",
    vtcBase: "07290 Satillieu, France",
    body: {
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: "07290 Satillieu, France",
        TCallerDestination: "07100 Annonay, France",
        TCallerdate: "15/06/2026",
        TCallerheure: "10:00",
      },
    },
  },
  {
    id: "Satillieu → Lyon (aller simple, classique)",
    vtcBase: "07290 Satillieu, France",
    body: {
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: "07290 Satillieu, France",
        TCallerDestination: "69002 Lyon, France",
        TCallerdate: "15/06/2026",
        TCallerheure: "10:00",
      },
    },
  },
  {
    id: "Satillieu → Lyon (aller/retour, classique)",
    vtcBase: "07290 Satillieu, France",
    body: {
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller/Retour",
        TCallerpriseencharge: "07290 Satillieu, France",
        TCallerDestination: "69002 Lyon, France",
        TCallerdate: "15/06/2026",
        TCallerheure: "10:00",
        TCretourpriseencharge: "69002 Lyon, France",
        TCretourDestination: "07290 Satillieu, France",
        TCretourdate: "15/06/2026",
        TCretourheure: "18:00",
      },
    },
  },
  {
    id: "Satillieu → Orly (aller simple, transfert aéroport)",
    vtcBase: "07290 Satillieu, France",
    body: {
      general: { TypeService: "Transfert Aéroport" },
      transfertAeroport: {
        TAtrajet: "Aller Simple",
        TAallerpriseencharge: "07290 Satillieu, France",
        TAallerdestination: "Aéroport Paris-Orly",
        TApassagers: "2",
      },
    },
  },
  {
    id: "Paris → Orly (aller simple, transfert aéroport)",
    vtcBase: "Paris, France",
    body: {
      general: { TypeService: "Transfert Aéroport" },
      transfertAeroport: {
        TAtrajet: "Aller Simple",
        TAallerpriseencharge: "75001 Paris, France",
        TAallerdestination: "Aéroport Paris-Orly",
        TApassagers: "2",
      },
    },
  },
];

async function main() {
  const apiKey = process.env.DISTANCE_MATRIX_API_KEY?.trim();
  console.log("=== 1) Validation pricingConfig (mapEngineToPricingConfig → validatePricingConfigPayload) ===\n");
  const samplePc = buildPayloadPricingConfig("07290 Satillieu, France");
  assertClassicTripShape(samplePc as unknown as Record<string, unknown>);
  const validated = validatePricingConfigPayload(samplePc);
  const ct = validated.classicTrip;
  console.log("OK — pricingConfig accepté par l’API.");
  console.log(`  classicTrip est un objet (pas un tableau).`);
  console.log(
    `  zoneBands: ${ct.zoneBands.length} (max autorisé ${MAX_ARRAY_ITEMS_RULES}), distanceRulesOneWay: ${ct.distanceRulesOneWay.length}, distanceRulesRoundTrip: ${ct.distanceRulesRoundTrip.length}`
  );
  console.log(
    `  Constante validateur MAX_ARRAY_ITEMS_RULES = ${MAX_ARRAY_ITEMS_RULES} (tableaux classicTrip bornés à cette taille).\n`
  );

  if (!apiKey) {
    console.warn(
      "DISTANCE_MATRIX_API_KEY absente — pas de calcul réel de distances. Exécutez avec .env renseigné pour l’audit complet.\n"
    );
    process.exit(0);
  }

  const tenant = getTenantConfig("default");
  if (!tenant) throw new Error("Tenant default introuvable.");

  console.log("=== 2) Cinq trajets (corps + pricingConfig injecté comme le ferait la route Next) ===\n");

  for (const sc of scenarios) {
    const pricingConfig = buildPayloadPricingConfig(sc.vtcBase);
    validatePricingConfigPayload(pricingConfig);
    const fullBody: Record<string, unknown> = {
      ...sc.body,
      vtcBaseAddress: sc.vtcBase,
      pricingConfig,
    };

    const resolved = resolvePricingEngineForRequest(tenant, fullBody);
    const typeKey = resolveServiceTypeKey(fullBody);
    if (!typeKey) {
      console.error(`[${sc.id}] type de service non résolu`);
      continue;
    }

    const distances = await calculerDistances(apiKey, fullBody, resolved.engine);
    const result = await calculerTarif(typeKey, fullBody, distances, resolved.engine);
    const debug = buildPricingDebugBreakdown({
      tenantId: tenant.id,
      typeKey,
      body: fullBody,
      engine: resolved.engine,
      distances,
      result,
    });

    console.log("—".repeat(72));
    console.log(sc.id);
    console.log(`  pricingConfigSource: ${resolved.source}`);
    console.log(`  vtcBaseAddressUsed: ${debug.vtcBaseAddressUsed}`);
    console.log(`  vtcBaseAddressSource: ${debug.vtcBaseAddressSource}`);
    console.log(`  TypeService (normalisé): ${normalizeTypeService((fullBody.general as { TypeService?: string })?.TypeService)}`);
    console.log("  Segments (km / min):");
    for (const s of debug.segments) {
      console.log(
        `    • ${s.label}: ${s.distanceKm ?? 0} km, ${s.durationMin ?? 0} min | ${s.from} → ${s.to} [${s.source ?? "?"}]`
      );
    }
    console.log("  pricingSteps (tarifs détaillés):");
    for (const step of debug.pricingSteps) {
      console.log(`    • ${step.label}${step.amount != null ? `: ${step.amount} €` : ""}${step.detail ? ` — ${step.detail}` : ""}`);
    }
    console.log("  rulesApplied:");
    for (const r of debug.rulesApplied) console.log(`    • ${r}`);
    console.log(`  tarif final (affichage): ${result.tarif} €\n`);
  }

  console.log("=== Fin audit ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
