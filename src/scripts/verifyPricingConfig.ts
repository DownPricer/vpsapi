/**
 * Vérification pricing selon paramètres dashboard (audit VTC).
 * Distances injectées — pas d’appel Distance Matrix.
 *
 * Usage : `npm run verify:pricing-config` (depuis vtc-core-api)
 */
import {
  calculerTarif,
  mapPricingConfigToEngine,
  validatePricingConfigPayload,
} from "../modules/pricing";
import type { PricingConfigPayload } from "../modules/pricing/payloadConfig.types";
import type { Distances } from "../modules/pricing/types";
import { resolveServiceTypeKey } from "../services/pricing.service";

const VTC_BASE = "55 Le Petit Mayard, 07290 Satillieu, France";
const SATILLIEU = "07290 Satillieu, France";

const emptyRetour: Distances["retour"] = {
  approche: { km: 0, duree: 0 },
  trajet: { km: 0, duree: 0 },
  retourBase: { km: 0, duree: 0 },
};

/** Paramètres alignés sur le rapport d’audit fonctionnel. */
function buildAuditPricingConfig(overrides?: {
  returnToBaseEnabled?: boolean;
  approachPricePerKm?: number;
  outOfZoneMultiplier?: number;
  oneWayPricePerKm?: number;
}): PricingConfigPayload {
  const returnToBaseEnabled = overrides?.returnToBaseEnabled ?? true;
  const approachPricePerKm = overrides?.approachPricePerKm ?? 2;
  const outOfZoneMultiplier = overrides?.outOfZoneMultiplier ?? 1;
  const oneWayPricePerKm = overrides?.oneWayPricePerKm ?? 2;
  return {
    version: "v1",
    currency: "EUR",
    timezone: "Europe/Paris",
    vtcBaseAddress: VTC_BASE,
    publicHolidays: ["01/05/2026"],
    airportBuffers: {
      default: { preFlightMin: 120, arrivalMin: 30, dropoffMarginMin: 10 },
    },
    classicTrip: {
      enabled: true,
      zoneBands: [{ zoneId: "1", label: "Zone 1", minPrincipalDistanceKm: 0, minimumPrice: 300, enabled: true }],
      distanceRulesOneWay: [
        {
          id: "zone-1-one-way",
          label: "AS zone 1",
          pricePerKm: oneWayPricePerKm,
          minimumPrice: 300,
          enabled: true,
        },
      ],
      distanceRulesRoundTrip: [
        {
          id: "zone-1-round-trip",
          label: "AR zone 1",
          pricePerKm: 1,
          minimumPrice: 300,
          enabled: true,
        },
      ],
      approach: { enabled: true, mode: "always_approach", pricePerKm: approachPricePerKm },
      returnToBase: {
        enabled: returnToBaseEnabled,
        mode: returnToBaseEnabled ? "always_return_base" : "none",
        pricePerKm: approachPricePerKm,
      },
      outOfPrimaryZone: { enabled: true, mode: "multiplier", value: outOfZoneMultiplier, zoneSetId: "fr-76" },
    },
    airportTransfers: {
      enabled: true,
      rules: [
        {
          id: "ory",
          code: "ORY",
          name: "Orly",
          aliases: ["orly", "ory"],
          address: "Aéroport de Paris-Orly, 94390 Orly, France",
          oneWay: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 1, minimumPrice: 200 }],
          roundTrip: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 1, minimumPrice: 200 }],
          enabled: true,
        },
        {
          id: "cdg",
          code: "CDG",
          name: "CDG",
          aliases: ["cdg", "roissy"],
          address: "Aéroport Charles de Gaulle, 95700 Roissy-en-France, France",
          oneWay: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.54, minimumPrice: 230 }],
          roundTrip: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.54, minimumPrice: 460 }],
          enabled: true,
        },
        {
          id: "bva",
          code: "BVA",
          name: "BVA",
          aliases: ["beauvais", "bva"],
          address: "Aéroport de Beauvais-Tillé, 60000 Tillé, France",
          oneWay: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.62, minimumPrice: 220 }],
          roundTrip: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.62, minimumPrice: 440 }],
          enabled: true,
        },
        {
          id: "cc",
          code: "CC",
          name: "CC",
          aliases: ["caen", "cc"],
          address: "Aéroport de Caen-Carpiquet, 14650 Carpiquet, France",
          oneWay: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.64, minimumPrice: 165 }],
          roundTrip: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 0.64, minimumPrice: 330 }],
          enabled: true,
        },
      ],
      fallbackAirportCode: "ORY",
    },
    hourlyHire: {
      enabled: true,
      minimumTotal: 200,
      rateRules: [{ id: "hourly-default", label: "Standard", hourlyRate: 80, enabled: true }],
    },
    surcharges: [
      { id: "night", label: "Nuit", type: "night", mode: "percent", value: 20, enabled: true },
      { id: "evening", label: "Soirée", type: "evening", mode: "percent", value: 10, enabled: true },
      { id: "weekend", label: "WE", type: "weekend", mode: "percent", value: 20, enabled: true },
      { id: "holiday", label: "Férié", type: "holiday", mode: "percent", value: 25, enabled: true },
    ],
    discounts: [
      {
        id: "round-trip-discount",
        label: "Remise aller-retour",
        trigger: "round_trip",
        mode: "percent",
        value: 5,
        enabled: true,
      },
    ],
    cityRules: [],
    options: [],
    passengerBagPolicy: { minPassengers: 1, maxPassengers: 4, bagPricingEnabled: false },
    rounding: { classic: "ceil", airport: "ceil_to_5", hourlyHire: "ceil" },
  };
}

type CaseResult = {
  id: string;
  tarif: number;
  attendu: string;
  formule: string;
  ok: boolean;
};

async function runCase(opts: {
  id: string;
  body: Record<string, unknown>;
  distances: Distances;
  config?: Parameters<typeof buildAuditPricingConfig>[0];
  assert: (tarif: number) => { ok: boolean; attendu: string; formule: string };
}): Promise<CaseResult> {
  const engine = mapPricingConfigToEngine(validatePricingConfigPayload(buildAuditPricingConfig(opts.config)));
  const typeKey = resolveServiceTypeKey(opts.body);
  if (!typeKey) throw new Error(`Type service inconnu: ${opts.id}`);
  const r = await calculerTarif(typeKey, opts.body, opts.distances, engine);
  const check = opts.assert(r.tarif);
  return {
    id: opts.id,
    tarif: r.tarif,
    attendu: check.attendu,
    formule: check.formule,
    ok: check.ok,
  };
}

/** Distances type audit ORY (~1085 € AS avec 1 €/km et ~500 km trajet). */
const distAirportOrlyLong: Distances = {
  aller: {
    approche: { km: 120, duree: 5400 },
    trajet: { km: 480, duree: 18000 },
    retourBase: { km: 120, duree: 5400 },
  },
  retour: {
    approche: { km: 118, duree: 5300 },
    trajet: { km: 478, duree: 17900 },
    retourBase: { km: 119, duree: 5350 },
  },
};

const distClassicShort: Distances = {
  aller: { approche: { km: 0.5, duree: 60 }, trajet: { km: 0, duree: 0 }, retourBase: { km: 0.5, duree: 60 } },
  retour: emptyRetour,
};

const distClassicLong: Distances = {
  aller: { approche: { km: 15, duree: 1200 }, trajet: { km: 80, duree: 4800 }, retourBase: { km: 15, duree: 1200 } },
  retour: emptyRetour,
};

const distClassicAr: Distances = {
  aller: { approche: { km: 10, duree: 800 }, trajet: { km: 40, duree: 2400 }, retourBase: { km: 10, duree: 800 } },
  retour: { approche: { km: 10, duree: 800 }, trajet: { km: 40, duree: 2400 }, retourBase: { km: 10, duree: 800 } },
};

/** Distances plus longues pour tester la remise 5 % au-dessus du minimum. */
const distClassicArRemise: Distances = {
  aller: { approche: { km: 25, duree: 1500 }, trajet: { km: 120, duree: 7200 }, retourBase: { km: 25, duree: 1500 } },
  retour: { approche: { km: 25, duree: 1500 }, trajet: { km: 120, duree: 7200 }, retourBase: { km: 25, duree: 1500 } },
};

/** Distances réalistes Satillieu → Lyon (audit retour dépôt). */
const distSatillieuLyon: Distances = {
  aller: {
    approche: { km: 1.587, duree: 240 },
    trajet: { km: 92.036, duree: 6000 },
    retourBase: { km: 91.997, duree: 6000 },
  },
  retour: emptyRetour,
};

/** Trajet long Satillieu → Paris pour tester le multiplicateur hors zone. */
const distSatillieuParis: Distances = {
  aller: {
    approche: { km: 12, duree: 900 },
    trajet: { km: 420, duree: 16800 },
    retourBase: { km: 12, duree: 900 },
  },
  retour: emptyRetour,
};

/** Trajet court Satillieu → Annonay (même département 07). */
const distSatillieuAnnonay: Distances = {
  aller: {
    approche: { km: 2, duree: 300 },
    trajet: { km: 28, duree: 1800 },
    retourBase: { km: 2, duree: 300 },
  },
  retour: emptyRetour,
};

async function main() {
  const dateAudit = "21/05/2026";
  const heureAudit = "12:43";

  const results: CaseResult[] = [];

  results.push(
    await runCase({
      id: "1. Classique court Satillieu→Satillieu",
      body: {
        vtcBaseAddress: VTC_BASE,
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: SATILLIEU,
          TCallerDestination: SATILLIEU,
          TCallerdate: dateAudit,
          TCallerheure: heureAudit,
        },
      },
      distances: distClassicShort,
      assert: (t) => ({
        ok: t >= 300,
        attendu: ">= 300 € (minimum classique)",
        formule: "max(segments + maj, min zone 1)",
      }),
    })
  );

  results.push(
    await runCase({
      id: "2. Classique long AS",
      body: {
        vtcBaseAddress: VTC_BASE,
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller Simple",
          TCallerpriseencharge: SATILLIEU,
          TCallerDestination: "69001 Lyon, France",
          TCallerdate: dateAudit,
          TCallerheure: heureAudit,
        },
      },
      distances: distClassicLong,
      assert: (t) => {
        const approche = 15 * 2;
        const trajet = 80 * (2 + 0.1);
        const retourBase = 15 * 2;
        const brut = approche + trajet + retourBase;
        const attenduMin = Math.max(Math.ceil(brut), 300);
        return {
          ok: t >= 300 && t >= attenduMin - 1,
          attendu: `>= ${attenduMin} € (km×2 + suppl. + min 300)`,
          formule: "approche+trajet+retourBase puis max(,300)",
        };
      },
    })
  );

  results.push(
    await runCase({
      id: "3. Classique AR (€/km retour = 1)",
      body: {
        vtcBaseAddress: VTC_BASE,
        general: { TypeService: "Trajet Classique" },
        trajetClassique: {
          TCtrajet: "Aller/Retour",
          TCallerpriseencharge: SATILLIEU,
          TCallerDestination: "69001 Lyon, France",
          TCallerdate: dateAudit,
          TCallerheure: heureAudit,
          TCretourpriseencharge: "69001 Lyon, France",
          TCretourDestination: SATILLIEU,
          TCretourdate: dateAudit,
          TCretourheure: "18:00",
        },
      },
      distances: distClassicAr,
      assert: (t) => ({
        ok: t >= 300,
        attendu: ">= 300 € + remise 5 % sur sous-total AR",
        formule: "(aller+retour)×0,95 + maj puis max(,300)",
      }),
    })
  );

  for (const [code, minAs, minAr] of [
    ["ORY", 200, 200],
    ["CDG", 230, 460],
    ["BVA", 220, 440],
    ["CC", 165, 330],
  ] as const) {
    const dest = code === "ORY" ? "Orly" : code === "CDG" ? "Charles de Gaulle" : code === "BVA" ? "Beauvais" : "Caen Carpiquet";
    results.push(
      await runCase({
        id: `${code} aller simple`,
        body: {
          vtcBaseAddress: VTC_BASE,
          general: { TypeService: "Transfert Aéroport" },
          transfertAeroport: {
            TAtrajet: "Aller Simple",
            TAallerpriseencharge: SATILLIEU,
            TAallerdestination: dest,
            TApassagers: "2",
            TAallerdate: dateAudit,
            TAallerhoraire: heureAudit,
          },
        },
        distances: distAirportOrlyLong,
        assert: (tarif) => ({
          ok: tarif >= minAs,
          attendu: `>= ${minAs} €`,
          formule: "max(Σ km×tarifKm, min aéroport) arrondi ceil5",
        }),
      })
    );
    results.push(
      await runCase({
        id: `${code} aller-retour`,
        body: {
          vtcBaseAddress: VTC_BASE,
          general: { TypeService: "Transfert Aéroport" },
          transfertAeroport: {
            TAtrajet: "Aller/Retour",
            TAallerpriseencharge: SATILLIEU,
            TAallerdestination: dest,
            TApassagers: "2",
            TAallerdate: dateAudit,
            TAallerhoraire: heureAudit,
            TAretourdate: dateAudit,
            TAretourhoraire: "20:00",
          },
        },
        distances: distAirportOrlyLong,
        assert: (tarif) => ({
          ok: tarif >= minAr,
          attendu: `>= ${minAr} € (pas de remise A/R sur transferts)`,
          formule: "max(aller+retour, min AR) ceil5",
        }),
      })
    );
  }

  results.push(
    await runCase({
      id: "MAD 1h",
      body: {
        vtcBaseAddress: VTC_BASE,
        general: { TypeService: "MAD Evenementiel" },
        madEvenementiel: {
          LieuEvenement: SATILLIEU,
          DateEvenement: dateAudit,
          HeureEvenement: heureAudit,
          HeureMADEvenement: "1",
        },
      },
      distances: { aller: { approche: { km: 0, duree: 0 }, trajet: { km: 0, duree: 0 }, retourBase: { km: 0, duree: 0 } }, retour: emptyRetour },
      assert: (t) => ({
        ok: t === 200,
        attendu: "200 €",
        formule: "max(1h×80, minimum 200)",
      }),
    })
  );

  results.push(
    await runCase({
      id: "MAD 3h",
      body: {
        vtcBaseAddress: VTC_BASE,
        general: { TypeService: "MAD Evenementiel" },
        madEvenementiel: {
          LieuEvenement: SATILLIEU,
          DateEvenement: dateAudit,
          HeureEvenement: heureAudit,
          HeureMADEvenement: "3",
        },
      },
      distances: { aller: { approche: { km: 0, duree: 0 }, trajet: { km: 0, duree: 0 }, retourBase: { km: 0, duree: 0 } }, retour: emptyRetour },
      assert: (t) => ({
        ok: t === 240,
        attendu: "240 €",
        formule: "3×80",
      }),
    })
  );

  {
    const bodyLyon = {
      vtcBaseAddress: VTC_BASE,
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: SATILLIEU,
        TCallerDestination: "69001 Lyon, France",
        TCallerdate: dateAudit,
        TCallerheure: heureAudit,
      },
    };
    const engineOn = mapPricingConfigToEngine(
      validatePricingConfigPayload(buildAuditPricingConfig({ approachPricePerKm: 2, returnToBaseEnabled: true }))
    );
    const engineOff = mapPricingConfigToEngine(
      validatePricingConfigPayload(buildAuditPricingConfig({ approachPricePerKm: 2, returnToBaseEnabled: false }))
    );
    const rOn = await calculerTarif("classique", bodyLyon, distSatillieuLyon, engineOn);
    const rOff = await calculerTarif("classique", bodyLyon, distSatillieuLyon, engineOff);
    results.push({
      id: "Retour dépôt ON (Satillieu→Lyon)",
      tarif: rOn.tarif,
      attendu: "> prix retour dépôt OFF",
      formule: "approche + trajet + retourBase facturé",
      ok: rOn.tarif > rOff.tarif,
    });
    results.push({
      id: "Retour dépôt OFF (Satillieu→Lyon)",
      tarif: rOff.tarif,
      attendu: "< prix retour dépôt ON",
      formule: "retourBase non facturé",
      ok: rOff.tarif < rOn.tarif,
    });
  }

  {
    const bodyParis = {
      vtcBaseAddress: VTC_BASE,
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: SATILLIEU,
        TCallerDestination: "75001 Paris, France",
        TCallerdate: dateAudit,
        TCallerheure: heureAudit,
      },
    };
    const bodyAnnonay = {
      vtcBaseAddress: VTC_BASE,
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: SATILLIEU,
        TCallerDestination: "07100 Annonay, France",
        TCallerdate: dateAudit,
        TCallerheure: heureAudit,
      },
    };
    const engineX1 = mapPricingConfigToEngine(
      validatePricingConfigPayload(
        buildAuditPricingConfig({ approachPricePerKm: 0, returnToBaseEnabled: false, outOfZoneMultiplier: 1 })
      )
    );
    const engineX15 = mapPricingConfigToEngine(
      validatePricingConfigPayload(
        buildAuditPricingConfig({ approachPricePerKm: 0, returnToBaseEnabled: false, outOfZoneMultiplier: 1.5 })
      )
    );
    const parisX1 = await calculerTarif("classique", bodyParis, distSatillieuParis, engineX1);
    const parisX15 = await calculerTarif("classique", bodyParis, distSatillieuParis, engineX15);
    const annonayX15 = await calculerTarif("classique", bodyAnnonay, distSatillieuAnnonay, engineX15);
    results.push({
      id: "Hors zone Paris ×1",
      tarif: parisX1.tarif,
      attendu: "< Paris ×1.5",
      formule: "destination hors zone d'exploitation",
      ok: parisX1.tarif < parisX15.tarif,
    });
    results.push({
      id: "Hors zone Paris ×1.5",
      tarif: parisX15.tarif,
      attendu: "> Paris ×1",
      formule: "×1.5 appliqué (destination Paris)",
      ok: parisX15.tarif > parisX1.tarif,
    });
    results.push({
      id: "Hors zone Annonay ×1.5 (local)",
      tarif: annonayX15.tarif,
      attendu: "300 € (pas de majoration abusive)",
      formule: "même département 07 → pas de ×1.5",
      ok: annonayX15.tarif === 300,
    });
  }

  {
    const engine = mapPricingConfigToEngine(validatePricingConfigPayload(buildAuditPricingConfig()));
    const bodyAr = {
      vtcBaseAddress: VTC_BASE,
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller/Retour",
        TCallerpriseencharge: SATILLIEU,
        TCallerDestination: "07100 Annonay, France",
        TCallerdate: "12/06/2026",
        TCallerheure: "10:00",
        TCretourpriseencharge: "07100 Annonay, France",
        TCretourDestination: SATILLIEU,
        TCretourdate: "12/06/2026",
        TCretourheure: "16:00",
      },
    };
    const bodyAs = {
      vtcBaseAddress: VTC_BASE,
      general: { TypeService: "Trajet Classique" },
      trajetClassique: {
        TCtrajet: "Aller Simple",
        TCallerpriseencharge: SATILLIEU,
        TCallerDestination: "07100 Annonay, France",
        TCallerdate: "12/06/2026",
        TCallerheure: "10:00",
      },
    };
    const rAr = await calculerTarif("classique", bodyAr, distClassicArRemise, engine);
    const engineSansRemise = { ...engine, applyArDiscount: false, arDiscountPercent: 0 };
    const rArSansRemise = await calculerTarif("classique", bodyAr, distClassicArRemise, engineSansRemise);
    const attenduAvecRemise = Math.ceil(rArSansRemise.tarif * 0.95);
    results.push({
      id: "Classique AR remise 5 %",
      tarif: rAr.tarif,
      attendu: `${attenduAvecRemise} € (≈ ${rArSansRemise.tarif} × 0,95)`,
      formule: "remise 5 % sur sous-total avant maj/min",
      ok: rAr.tarif <= rArSansRemise.tarif && rAr.tarif >= attenduAvecRemise - 1,
    });
  }

  console.log("\n=== verify:pricing-config (audit VTC) ===\n");
  let failed = 0;
  for (const r of results) {
    const status = r.ok ? "OK" : "KO";
    if (!r.ok) failed++;
    console.log(`[${status}] ${r.id}`);
    console.log(`  Tarif obtenu : ${r.tarif} €`);
    console.log(`  Attendu      : ${r.attendu}`);
    console.log(`  Formule      : ${r.formule}`);
  }
  console.log(`\n${results.length - failed}/${results.length} cas OK`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
