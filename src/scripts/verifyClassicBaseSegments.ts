/**
 * Vérifie la logique « trajet classique » : base→prise en charge, trajet client,
 * destination→base (sans min historique), stabilité du tarif, impact d’une base plus loin.
 * Exécution : `npm run verify:classic-base-segments` (racine vtc-core-api).
 */
import defaultEngineJson from "../config/tenants/engines/default.engine.json";
import { parsePricingEngineJson } from "../config/tenants/engineSchema";
import { calculerTarif } from "../modules/pricing/calculator";
import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";
import type { Distances } from "../modules/pricing/types";

const engine = parsePricingEngineJson(defaultEngineJson) as TenantPricingEngineConfig;
if (!engine.depotAddress?.trim()) {
  (engine as { depotAddress: string }).depotAddress = "Dépôt test, 76000 Rouen, France";
}

const emptyRetour: Distances["retour"] = {
  approche: { km: 0, duree: 0 },
  trajet: { km: 0, duree: 0 },
  retourBase: { km: 0, duree: 0 },
};

function basePayload(vtcBase: string): Record<string, unknown> {
  return {
    vtcBaseAddress: vtcBase,
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "1 rue test, 76300 Bihorel, France",
      TCallerDestination: "5 avenue test, 76000 Rouen, France",
      TCallerdate: "10/05/2026",
      TCallerheure: "14:30",
    },
  };
}

function distancesCase(approcheKm: number, trajetKm: number, retourBaseKm: number): Distances {
  return {
    aller: {
      approche: { km: approcheKm, duree: approcheKm * 60 },
      trajet: { km: trajetKm, duree: trajetKm * 60 },
      retourBase: { km: retourBaseKm, duree: retourBaseKm * 60 },
    },
    retour: emptyRetour,
  };
}

async function main() {
  const p = basePayload("Base proche, 76000 Rouen, France");
  const dClose = distancesCase(2, 15, 2.5);
  const dFar = distancesCase(40, 15, 42);

  const rClose = await calculerTarif("classique", p, dClose, engine);
  const rFar = await calculerTarif("classique", p, dFar, engine);
  const rCloseReplay = await calculerTarif("classique", p, dClose, engine);

  console.log("[scénario 1] base proche — tarif affiché:", rClose.tarif);
  console.log("[scénario 2] base lointaine (même trajet client, segments base plus longs) — tarif:", rFar.tarif);
  console.log("[scénario 3] même payload + mêmes distances rejoué — tarif:", rCloseReplay.tarif);

  if (rFar.tarif <= rClose.tarif) {
    throw new Error("Attendu : base lointaine => tarif strictement supérieur.");
  }
  if (rCloseReplay.tarif !== rClose.tarif) {
    throw new Error("Attendu : même entrée => même tarif (bit-identique).");
  }

  const aller = rClose.tarifs.aller as Record<string, number>;
  if (!(aller.approche > 0) || !(aller.retourBase > 0)) {
    throw new Error(
      "Attendu : approche et retour dépôt facturés (plus de règle min qui annule l’un des deux)."
    );
  }

  console.log("[verifyClassicBaseSegments] OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
