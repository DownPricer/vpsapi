/**
 * Égalité stricte tenant_engine vs moteur reconstruit depuis pricingConfig
 * (mapEngineToPricingConfig → validate → mapPricingConfigToEngine).
 *
 * Les distances sont injectées (pas d’appel Distance Matrix) pour isoler les écarts de config.
 * Usage : `npx tsx src/scripts/verifyTenantEnginePricingConfigParity.ts`
 */
import { getTenantConfig } from "../config/tenants/registry";
import {
  calculerTarif,
  mapEngineToPricingConfig,
  mapPricingConfigToEngine,
  validatePricingConfigPayload,
} from "../modules/pricing";
import type { Distances, TarifResult } from "../modules/pricing/types";
import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";
import { resolveServiceTypeKey } from "../services/pricing.service";

/** Copie de la logique `calculator.ts` (non exportée) pour le rapport. */
function zoneFromDistanceKm(d: number): number {
  const x = Number(d) || 0;
  if (x <= 15) return 1;
  if (x <= 35) return 2;
  if (x <= 80) return 3;
  if (x <= 120) return 4;
  return 5;
}

function classicZoneKmReport(distances: Distances, isAR: boolean): string {
  const a = distances.aller.trajet.km ?? 0;
  if (!isAR) return `zoneIndex=${zoneFromDistanceKm(a)} (depuis trajet client aller ${a} km)`;
  const b = distances.retour.trajet.km ?? 0;
  const zoneKm = Math.max(a, b);
  return `zoneIndex=${zoneFromDistanceKm(zoneKm)} (max trajets client aller ${a} km / retour ${b} km)`;
}

function stableStringifyDistances(d: Distances): string {
  return JSON.stringify(d);
}

function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function compareTarifResults(
  label: string,
  a: TarifResult,
  b: TarifResult
): { identical: boolean; lines: string[] } {
  const lines: string[] = [];
  let identical = true;

  if (a.tarif !== b.tarif) {
    identical = false;
    lines.push(`  tarif final: tenant_engine=${a.tarif} € | pricingConfig=${b.tarif} €`);
  } else {
    lines.push(`  tarif final: ${a.tarif} € (identique)`);
  }

  if (stableStringifyDistances(a.distances) !== stableStringifyDistances(b.distances)) {
    identical = false;
    lines.push(`  distances: DIFFÉRENT (inattendu si même objet injecté)`);
  } else {
    lines.push(`  segments (distances): identiques`);
  }

  const majA = JSON.stringify(a.majorations ?? []);
  const majB = JSON.stringify(b.majorations ?? []);
  if (majA !== majB) {
    identical = false;
    lines.push(`  majorations: tenant=${majA} | payload=${majB}`);
  } else {
    lines.push(`  majorations: ${majA}`);
  }

  const ta = a.tarifs as Record<string, unknown>;
  const tb = b.tarifs as Record<string, unknown>;
  const keys = new Set([...Object.keys(ta), ...Object.keys(tb)]);
  for (const k of keys) {
    const va = ta[k];
    const vb = tb[k];
    if (typeof va === "number" && typeof vb === "number") {
      if (!nearlyEqual(va, vb)) {
        identical = false;
        lines.push(`  tarifs.${k}: ${va} vs ${vb}`);
      }
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      identical = false;
      lines.push(`  tarifs.${k}: différent`);
    }
  }

  if (!identical) lines.unshift(`[${label}] ÉCART`);
  return { identical, lines };
}

function engineFromPricingConfig(
  tenantEngine: TenantPricingEngineConfig,
  vtcBaseAddress: string
): TenantPricingEngineConfig {
  const payload = mapEngineToPricingConfig(tenantEngine, { vtcBaseAddress });
  const validated = validatePricingConfigPayload(payload);
  return mapPricingConfigToEngine(validated);
}

function summarizeTcZones(e: TenantPricingEngineConfig): string {
  const simpleKeys = Object.keys(e.tcTable.SIMPLE.ZONES).sort().join(",");
  const arKeys = Object.keys(e.tcTable.AR.ZONES).sort().join(",");
  return `SIMPLE.ZONES=[${simpleKeys}] AR.ZONES=[${arKeys}]`;
}

async function runCase(opts: {
  id: string;
  body: Record<string, unknown>;
  distances: Distances;
  zoneNote: string;
}) {
  const tenant = getTenantConfig("default");
  if (!tenant) throw new Error("Tenant default introuvable.");

  const vtcBase =
    typeof opts.body.vtcBaseAddress === "string" ? opts.body.vtcBaseAddress.trim() : tenant.pricingEngine.depotAddress;

  const tenantEngine = tenant.pricingEngine;
  const payloadEngine = engineFromPricingConfig(tenantEngine, vtcBase);

  const typeKey = resolveServiceTypeKey(opts.body);
  if (!typeKey) throw new Error(`Type inconnu: ${opts.id}`);

  const rTenant = await calculerTarif(typeKey, opts.body, opts.distances, tenantEngine);
  const rPayload = await calculerTarif(typeKey, opts.body, opts.distances, payloadEngine);

  const cmp = compareTarifResults(opts.id, rTenant, rPayload);

  console.log("\n" + "═".repeat(76));
  console.log(opts.id);
  console.log(`  Zone (indicatif algo classique / trajet): ${opts.zoneNote}`);
  console.log(`  Moteur payload: ${summarizeTcZones(payloadEngine)}`);
  if (summarizeTcZones(tenantEngine) !== summarizeTcZones(payloadEngine)) {
    console.log(`  Moteur tenant : ${summarizeTcZones(tenantEngine)} (≠ payload)`);
  }
  for (const line of cmp.lines) console.log(line);
  console.log(`  Verdict: ${cmp.identical ? "IDENTIQUE" : "NON IDENTIQUE"}`);

  return cmp.identical;
}

const emptyRetour: Distances["retour"] = {
  approche: { km: 0, duree: 0 },
  trajet: { km: 0, duree: 0 },
  retourBase: { km: 0, duree: 0 },
};

async function main() {
  const tenant = getTenantConfig("default");
  if (!tenant) throw new Error("Tenant default introuvable.");

  console.log("=== Parité tenant_engine vs pricingConfig (distances figées) ===\n");
  console.log(
    `Tenant default — primaryServiceZoneSetId=${tenant.pricingEngine.primaryServiceZoneSetId}, mult hors zone=${tenant.pricingEngine.outOfPrimaryServiceZoneMultiplier}`
  );

  const dateMidWeek = "12/06/2026";
  const heureDay = "10:00";

  const bodyClassicAsClose: Record<string, unknown> = {
    vtcBaseAddress: "76000 Rouen, France",
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "76300 Bihorel, France",
      TCallerDestination: "76000 Rouen, France",
      TCallerdate: dateMidWeek,
      TCallerheure: heureDay,
    },
  };

  const distClassicBaseProche: Distances = {
    aller: {
      approche: { km: 2, duree: 300 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 3, duree: 400 },
    },
    retour: emptyRetour,
  };

  const distClassicBaseLoin: Distances = {
    aller: {
      approche: { km: 38, duree: 3600 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 40, duree: 3800 },
    },
    retour: emptyRetour,
  };

  const bodyClassicAsFar = { ...bodyClassicAsClose, vtcBaseAddress: "59000 Lille, France" };

  const bodyClassicAr: Record<string, unknown> = {
    vtcBaseAddress: "76000 Rouen, France",
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller/Retour",
      TCallerpriseencharge: "76300 Bihorel, France",
      TCallerDestination: "76000 Rouen, France",
      TCallerdate: dateMidWeek,
      TCallerheure: heureDay,
      TCretourpriseencharge: "76000 Rouen, France",
      TCretourDestination: "76300 Bihorel, France",
      TCretourdate: dateMidWeek,
      TCretourheure: "16:00",
    },
  };

  const distClassicAr: Distances = {
    aller: {
      approche: { km: 2, duree: 300 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 3, duree: 400 },
    },
    retour: {
      approche: { km: 4, duree: 500 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 3, duree: 400 },
    },
  };

  const distClassicArBaseLoin: Distances = {
    aller: {
      approche: { km: 35, duree: 3200 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 36, duree: 3300 },
    },
    retour: {
      approche: { km: 6, duree: 600 },
      trajet: { km: 8, duree: 900 },
      retourBase: { km: 34, duree: 3100 },
    },
  };

  const bodyAirport: Record<string, unknown> = {
    vtcBaseAddress: "76000 Rouen, France",
    general: { TypeService: "Transfert Aéroport" },
    transfertAeroport: {
      TAtrajet: "Aller Simple",
      TAallerpriseencharge: "76300 Bihorel, France",
      TAallerdestination: "Orly",
      TApassagers: "2",
    },
  };

  const distAirport: Distances = {
    aller: {
      approche: { km: 3, duree: 400 },
      trajet: { km: 120, duree: 5400 },
      retourBase: { km: 125, duree: 5600 },
    },
    retour: emptyRetour,
  };

  const distAirportBaseLoin: Distances = {
    aller: {
      approche: { km: 200, duree: 9000 },
      trajet: { km: 120, duree: 5400 },
      retourBase: { km: 205, duree: 9200 },
    },
    retour: emptyRetour,
  };

  const bodyAirportFar = { ...bodyAirport, vtcBaseAddress: "59000 Lille, France" };

  const cases: Array<{ id: string; body: Record<string, unknown>; distances: Distances; zoneNote: string }> = [
    {
      id: "1) Classique aller simple — base proche (Rouen)",
      body: bodyClassicAsClose,
      distances: distClassicBaseProche,
      zoneNote: classicZoneKmReport(distClassicBaseProche, false),
    },
    {
      id: "2) Classique aller simple — base lointaine (Lille)",
      body: bodyClassicAsFar,
      distances: distClassicBaseLoin,
      zoneNote: classicZoneKmReport(distClassicBaseLoin, false),
    },
    {
      id: "3) Classique aller-retour — base proche",
      body: bodyClassicAr,
      distances: distClassicAr,
      zoneNote: classicZoneKmReport(distClassicAr, true),
    },
    {
      id: "4) Classique aller-retour — base lointaine",
      body: { ...bodyClassicAr, vtcBaseAddress: "59000 Lille, France" },
      distances: distClassicArBaseLoin,
      zoneNote: classicZoneKmReport(distClassicArBaseLoin, true),
    },
    {
      id: "5) Transfert aéroport — base proche",
      body: bodyAirport,
      distances: distAirport,
      zoneNote: "Grille TA ORY, plage 1-2 passagers (zone €/km interne au type aéroport)",
    },
    {
      id: "6) Transfert aéroport — base lointaine",
      body: bodyAirportFar,
      distances: distAirportBaseLoin,
      zoneNote: "idem ORY — distances base→trajet plus longues",
    },
  ];

  const results: boolean[] = [];
  for (const c of cases) {
    results.push(await runCase(c));
  }

  console.log("\n" + "═".repeat(76));
  console.log("=== Synthèse ===");
  const allOk = results.every(Boolean);
  console.log(allOk ? "Tous les cas : IDENTIQUE" : "Au moins un cas : NON IDENTIQUE");

  if (!allOk) {
    console.log(
      "\nSi écart : cause typique = tables `tcTable` / `taTable` ou grilles non préservées au roundtrip" +
        " mapEngineToPricingConfig → mapPricingConfigToEngine (ex. zoneBands « default » vs zones numériques 1..5)."
    );
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
