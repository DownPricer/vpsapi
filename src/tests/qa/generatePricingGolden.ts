/**
 * Génère fixtures/pricing-golden.json (≥60 cas) à partir du moteur default actuel.
 * Usage: npx tsx src/tests/qa/generatePricingGolden.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { calculerTarif } from "../../modules/pricing/calculator";
import { applyVehicleToResult } from "../../modules/pricing/vehicleSurchargeApply";
import type { TenantPricingEngineConfig } from "../../modules/pricing/engineTypes";

const engine = JSON.parse(
  readFileSync("./src/config/tenants/engines/default.engine.json", "utf8")
) as TenantPricingEngineConfig;

const emptyRetour = {
  approche: { km: 0, duree: 0 },
  trajet: { km: 0, duree: 0 },
  retourBase: { km: 0, duree: 0 },
};

function dist(km: number, duree = Math.round(km * 60)) {
  return {
    aller: {
      approche: { km: 5, duree: 600 },
      trajet: { km, duree },
      retourBase: { km: 5, duree: 600 },
    },
    retour: {
      approche: { km: 5, duree: 600 },
      trajet: { km, duree },
      retourBase: { km: 5, duree: 600 },
    },
  };
}

type CaseDef = {
  id: string;
  meta: Record<string, unknown>;
  type: "classique" | "aeroport" | "mad-evenementiel";
  body: Record<string, unknown>;
  distances: ReturnType<typeof dist> | { aller: typeof emptyRetour; retour: typeof emptyRetour };
};

async function main() {
  const cases: CaseDef[] = [];
  const push = (c: CaseDef) => cases.push(c);

  for (const km of [20, 50, 80, 120, 200, 350]) {
    push({
      id: `as-km-${km}`,
      meta: { scenario: "AS", km },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: "15/05/2026",
          TCallerheure: "12:00",
        },
      },
      distances: dist(km),
    });
  }

  for (const [tag, date, heure] of [
    ["nuit", "15/05/2026", "23:30"],
    ["soir", "15/05/2026", "20:00"],
    ["dimanche", "17/05/2026", "12:00"],
    ["ferie", "01/05/2026", "12:00"],
    ["ferie-nuit", "01/05/2026", "23:00"],
  ] as const) {
    push({
      id: `as-${tag}`,
      meta: { scenario: "AS", tag },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: date,
          TCallerheure: heure,
        },
      },
      distances: dist(200),
    });
  }

  for (const km of [50, 120, 200]) {
    push({
      id: `ar-km-${km}`,
      meta: { scenario: "AR", km },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller/Retour",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: "15/05/2026",
          TCallerheure: "10:00",
          TCretourdate: "15/05/2026",
          TCretourheure: "18:00",
        },
      },
      distances: dist(km),
    });
  }

  push({
    id: "ar-ferie",
    meta: { scenario: "AR", tag: "ferie" },
    type: "classique",
    body: {
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller/Retour",
        TCallerpriseencharge: "76000 Rouen",
        TCallerDestination: "75001 Paris",
        TCallerdate: "01/05/2026",
        TCallerheure: "10:00",
        TCretourdate: "01/05/2026",
        TCretourheure: "18:00",
      },
    },
    distances: dist(200),
  });

  for (const h of [1, 3, 5]) {
    push({
      id: `mad-h-${h}`,
      meta: { scenario: "MAD", h },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "A/R + Mise à disposition",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: "15/05/2026",
          TCallerheure: "10:00",
          TCretourdate: "15/05/2026",
          TCretourheure: "18:00",
          HeureMADClassique: String(h),
        },
      },
      distances: dist(80),
    });
  }

  for (const [tag, date, heure, h] of [
    ["std-1h", "15/05/2026", "14:00", "1"],
    ["std-3h", "15/05/2026", "14:00", "3"],
    ["std-5h", "15/05/2026", "14:00", "5"],
    ["we", "16/05/2026", "14:00", "3"],
    ["ferie", "01/05/2026", "14:00", "3"],
    ["soir", "15/05/2026", "20:00", "3"],
    ["nuit", "15/05/2026", "23:00", "3"],
  ] as const) {
    push({
      id: `evt-${tag}`,
      meta: { scenario: "EVENEMENTIEL", tag },
      type: "mad-evenementiel",
      body: {
        general: { TypeService: "MAD Evenementiel" },
        madEvenementiel: {
          LieuEvenement: "76000 Rouen",
          DateEvenement: date,
          HeureEvenement: heure,
          HeureMADEvenement: h,
        },
      },
      distances: { aller: emptyRetour, retour: emptyRetour },
    });
  }

  for (const [code, dest] of [
    ["ORY", "Aéroport de Paris-Orly, 94390 Orly"],
    ["CDG", "Aéroport Charles de Gaulle, Roissy"],
    ["BVA", "Aéroport de Beauvais-Tillé"],
    ["CC", "Aéroport de Caen-Carpiquet"],
  ] as const) {
    for (const km of [80, 150]) {
      push({
        id: `air-${code}-${km}`,
        meta: { scenario: "AERO", code, km },
        type: "aeroport",
        body: {
          general: { TypeService: "Transfert Aéroport" },
          transfertAeroport: {
            TAtrajet: "Aller Simple",
            TAallerdate: "15/05/2026",
            TAallerhoraire: "10:00",
            TAallerdestination: dest,
            TApassagers: "2",
          },
          AdresseArrivee_1: dest,
        },
        distances: dist(km),
      });
    }
  }

  // Zones additionnelles AS (approche seule / courte)
  for (const km of [5, 15, 35, 45, 70, 95, 140, 180, 250, 400, 500]) {
    push({
      id: `as-zone-km-${km}`,
      meta: { scenario: "AS", km, tag: "zone-grid" },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "76100 Rouen",
          TCallerdate: "12/05/2026",
          TCallerheure: "11:00",
        },
      },
      distances: dist(km),
    });
  }

  push({
    id: "as-hors-zone-paris",
    meta: { scenario: "AS", tag: "hors-zone" },
    type: "classique",
    body: {
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: "75001 Paris",
        TCallerDestination: "69001 Lyon",
        TCallerdate: "15/05/2026",
        TCallerheure: "12:00",
      },
    },
    distances: dist(200),
  });

  // Compléments pour ≥60 cas : AR créneaux, aéro AR, MAD week-end/férié
  for (const [tag, date, heure] of [
    ["ar-nuit", "15/05/2026", "23:00"],
    ["ar-soir", "15/05/2026", "20:00"],
    ["ar-dimanche", "17/05/2026", "12:00"],
  ] as const) {
    push({
      id: tag,
      meta: { scenario: "AR", tag },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller/Retour",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: date,
          TCallerheure: heure,
          TCretourdate: date,
          TCretourheure: "18:00",
        },
      },
      distances: dist(150),
    });
  }

  for (const code of ["ORY", "CDG"] as const) {
    const dest =
      code === "ORY"
        ? "Aéroport de Paris-Orly, 94390 Orly"
        : "Aéroport Charles de Gaulle, Roissy";
    push({
      id: `air-${code}-ar-120`,
      meta: { scenario: "AERO", code, tag: "AR" },
      type: "aeroport",
      body: {
        general: { TypeService: "Transfert Aéroport" },
        transfertAeroport: {
          TAtrajet: "Aller/Retour",
          TAallerdate: "15/05/2026",
          TAallerhoraire: "08:00",
          TAallerdestination: dest,
          TAretourdate: "15/05/2026",
          TAretourhoraire: "18:00",
          TAretourdestination: "76000 Rouen",
          TApassagers: "2",
        },
        AdresseArrivee_1: dest,
        AdresseDepart_2: dest,
      },
      distances: dist(120),
    });
  }

  for (const [tag, date] of [
    ["mad-we", "16/05/2026"],
    ["mad-ferie", "01/05/2026"],
    ["mad-nuit", "15/05/2026"],
  ] as const) {
    push({
      id: tag,
      meta: { scenario: "MAD", tag },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "A/R + Mise à disposition",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: date,
          TCallerheure: tag === "mad-nuit" ? "23:00" : "10:00",
          TCretourdate: date,
          TCretourheure: "18:00",
          HeureMADClassique: "3",
        },
      },
      distances: dist(100),
    });
  }

  for (const km of [60, 90, 110, 160]) {
    push({
      id: `as-extra-${km}`,
      meta: { scenario: "AS", km, tag: "extra" },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75008 Paris",
          TCallerdate: "20/05/2026",
          TCallerheure: "09:30",
        },
      },
      distances: dist(km),
    });
  }

  // Fériés 2027-2028 (calcul programmatique — hors liste figée 2025-2026)
  for (const [tag, date] of [
    ["ferie-2027-0101", "01/01/2027"],
    ["ferie-2027-paques", "29/03/2027"],
    ["ferie-2027-0105", "01/05/2027"],
    ["ferie-2027-1407", "14/07/2027"],
    ["ferie-2027-2512", "25/12/2027"],
    ["ferie-2028-0101", "01/01/2028"],
    ["ferie-2028-paques", "17/04/2028"],
    ["ferie-2028-0105", "01/05/2028"],
    ["ferie-2028-1407", "14/07/2028"],
    ["ferie-2028-2512", "25/12/2028"],
  ] as const) {
    push({
      id: `as-${tag}`,
      meta: { scenario: "AS", tag, year: date.slice(-4) },
      type: "classique",
      body: {
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: "76000 Rouen",
          TCallerDestination: "75001 Paris",
          TCallerdate: date,
          TCallerheure: "12:00",
        },
      },
      distances: dist(200),
    });
  }

  const out: unknown[] = [];
  for (const c of cases) {
    const result = await calculerTarif(c.type, c.body, c.distances as never, engine);
    out.push({
      id: c.id,
      meta: c.meta,
      type: c.type,
      body: c.body,
      distances: c.distances,
      expectedTarif: result.tarif,
      expectedMajTotal: result.majorations.reduce((s, m) => s + m.montant, 0),
    });
  }

  const vehicleCases = [
    { id: "veh-fixed-50", mode: "fixed" as const, value: 50 },
    { id: "veh-per-km-05", mode: "per_km" as const, value: 0.5 },
    { id: "veh-pct-km-20", mode: "percent_km" as const, value: 20 },
    { id: "veh-none", mode: "none" as const, value: 0 },
  ];

  const baseBody = {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "75001 Paris",
      TCallerdate: "15/05/2026",
      TCallerheure: "12:00",
    },
  };

  for (const v of vehicleCases) {
    const baseResult = await calculerTarif("classique", baseBody, dist(200), engine);
    const vehicle = {
      id: "golden-veh",
      name: "Classe V",
      surchargeMode: v.mode,
      surchargeValue: v.value,
      passengerMax: 4,
    };
    applyVehicleToResult(baseResult, vehicle);
    out.push({
      id: v.id,
      meta: { scenario: "VEHICLE", ...v },
      type: "classique",
      body: baseBody,
      distances: dist(200),
      vehicle,
      expectedTarif: baseResult.tarif,
      expectedBase: baseResult.tarifBase,
    });
  }

  mkdirSync(path.join("src/tests/qa/fixtures"), { recursive: true });
  const dest = "src/tests/qa/fixtures/pricing-golden.json";
  writeFileSync(
    dest,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        engine: "default.engine.json",
        note: "Filet de sécurité pré-déploiement — échoue si un prix change.",
        cases: out,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${out.length} cases → ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
