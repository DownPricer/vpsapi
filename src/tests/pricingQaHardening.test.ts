import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { describe, it } from "node:test";
import {
  PricingCalculationError,
  calculerTarif,
  mapEngineToPricingConfig,
  mapPricingConfigToEngine,
  validatePricingConfigPayload,
  PricingConfigValidationError,
} from "../modules/pricing";
import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";
import { validateTenantSettingsPayload } from "../validation/tenantSettingsPayload";

const emptyRetour = {
  approche: { km: 0, duree: 0 },
  trajet: { km: 0, duree: 0 },
  retourBase: { km: 0, duree: 0 },
};

function loadEngine(id: string): TenantPricingEngineConfig {
  return JSON.parse(
    readFileSync(`./src/config/tenants/engines/${id}.engine.json`, "utf8")
  ) as TenantPricingEngineConfig;
}

function classicBody() {
  return {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "76100 Rouen",
      TCallerdate: "21/05/2026",
      TCallerheure: "12:43",
    },
  };
}

function auditLikePayload(overrides: Record<string, unknown> = {}) {
  return {
    version: "v1" as const,
    currency: "EUR" as const,
    timezone: "Europe/Paris",
    vtcBaseAddress: "55 Le Petit Mayard, 07290 Satillieu, France",
    publicHolidays: ["01/05/2026"],
    airportBuffers: { default: { preFlightMin: 120, arrivalMin: 30, dropoffMarginMin: 10 } },
    classicTrip: {
      enabled: true,
      zoneBands: [
        { zoneId: "1", label: "Zone 1", minPrincipalDistanceKm: 0, minimumPrice: 30, enabled: true },
      ],
      distanceRulesOneWay: [
        { id: "ow", label: "AS", pricePerKm: 2, minimumPrice: 30, enabled: true },
      ],
      distanceRulesRoundTrip: [
        { id: "rt", label: "AR", pricePerKm: 1, minimumPrice: 30, enabled: true },
      ],
      approach: { enabled: true, mode: "always_approach" as const, pricePerKm: 0.5 },
      returnToBase: { enabled: true, mode: "always_return_base" as const, pricePerKm: 0.5 },
      outOfPrimaryZone: {
        enabled: true,
        mode: "multiplier" as const,
        value: 1.05,
        zoneSetId: "fr-76",
      },
    },
    airportTransfers: {
      enabled: true,
      rules: [
        {
          id: "ory",
          code: "ORY",
          name: "Orly",
          aliases: ["orly"],
          address: "Orly",
          oneWay: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 1, minimumPrice: 200 }],
          roundTrip: [{ passengerMin: 1, passengerMax: 2, pricePerKm: 1, minimumPrice: 200 }],
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
    surcharges: [],
    discounts: [
      {
        id: "round-trip-discount",
        label: "Remise AR",
        trigger: "round_trip" as const,
        mode: "percent" as const,
        value: 5,
        enabled: true,
      },
    ],
    cityRules: [],
    options: [],
    passengerBagPolicy: { minPassengers: 1, maxPassengers: 4, bagPricingEnabled: false },
    rounding: { classic: "ceil" as const, airport: "ceil_to_5" as const, hourlyHire: "ceil" as const },
    ...overrides,
  };
}

describe("QA hardening — validation pricingConfig", () => {
  it("accepte default et client-demo après mapEngineToPricingConfig", () => {
    for (const id of ["default", "client-demo"] as const) {
      const engine = loadEngine(id);
      const payload = mapEngineToPricingConfig(engine, {
        vtcBaseAddress: engine.depotAddress || "France",
      });
      assert.doesNotThrow(() => validatePricingConfigPayload(payload));
    }
  });

  it("refuse pricePerKm = 0 sur une règle activée", () => {
    const p = auditLikePayload();
    (p.classicTrip as any).distanceRulesOneWay[0].pricePerKm = 0;
    assert.throws(() => validatePricingConfigPayload(p), PricingConfigValidationError);
  });

  it("refuse remise A/R ≥ 100 %", () => {
    const p = auditLikePayload();
    (p.discounts as any)[0].value = 100;
    assert.throws(() => validatePricingConfigPayload(p), PricingConfigValidationError);
  });

  it("refuse multiplicateur hors zone < 1", () => {
    const p = auditLikePayload();
    (p.classicTrip as any).outOfPrimaryZone.value = 0.5;
    assert.throws(() => validatePricingConfigPayload(p), PricingConfigValidationError);
  });

  it("refuse minimumTotal événementiel = 0 si MAD activée", () => {
    const p = auditLikePayload();
    (p.hourlyHire as any).minimumTotal = 0;
    assert.throws(() => validatePricingConfigPayload(p), PricingConfigValidationError);
  });
});

describe("QA hardening — calculateur", () => {
  it("non-régression supplément km (défauts historiques) sur 7 distances", async () => {
    const engine = loadEngine("default");
    const expected: Record<number, number> = {
      0: 30,
      1: 30,
      25: 61,
      50: 140,
      51: 140,
      80: 173,
      120: 234,
    };
    for (const km of Object.keys(expected).map(Number)) {
      const r = await calculerTarif(
        "classique",
        classicBody(),
        {
          aller: {
            approche: { km: 5, duree: 300 },
            trajet: { km, duree: km * 60 },
            retourBase: { km: 5, duree: 300 },
          },
          retour: emptyRetour,
        },
        engine
      );
      assert.equal(r.tarif, expected[km], `km=${km}`);
    }
  });

  it("majoration manuelle négative est ignorée (pas de baisse)", async () => {
    const engine = loadEngine("default");
    const distances = {
      aller: {
        approche: { km: 10, duree: 600 },
        trajet: { km: 200, duree: 7200 },
        retourBase: { km: 10, duree: 600 },
      },
      retour: emptyRetour,
    };
    const base = await calculerTarif("classique", classicBody(), distances, engine);
    const withNeg = await calculerTarif(
      "classique",
      {
        ...classicBody(),
        general: { TypeService: "Trajet Classique", majoration_aller: -50 },
      },
      distances,
      engine
    );
    assert.equal(withNeg.tarif, base.tarif);
  });

  it("tarif ≤ 0 lève PricingCalculationError (MAD min 0 contourné via engine)", async () => {
    const engine = loadEngine("default");
    const poisoned: TenantPricingEngineConfig = {
      ...engine,
      madHourlyRates: { default: 0, eveningOrNight: 0, weekendOrHoliday: 0 },
      madEventMinimumTotal: 0,
    };
    await assert.rejects(
      () =>
        calculerTarif(
          "mad-evenementiel",
          {
            general: { TypeService: "MAD Evenementiel" },
            madEvenementiel: {
              DateEvenement: "21/05/2026",
              HeureEvenement: "12:43",
              HeureMADEvenement: "3",
              LieuEvenement: "Rouen",
            },
          },
          { aller: emptyRetour, retour: emptyRetour },
          poisoned
        ),
      (e: unknown) => e instanceof PricingCalculationError
    );
  });

  it("map engine→payload→engine : tarifs identiques (supplément court branché ou défaut)", async () => {
    const engine = loadEngine("default");
    const payload = mapEngineToPricingConfig(engine, {
      vtcBaseAddress: engine.depotAddress || "France",
    });
    const rebuilt = mapPricingConfigToEngine(validatePricingConfigPayload(payload));
    const distances = {
      aller: {
        approche: { km: 5, duree: 300 },
        trajet: { km: 25, duree: 1500 },
        retourBase: { km: 5, duree: 300 },
      },
      retour: emptyRetour,
    };
    const a = await calculerTarif("classique", classicBody(), distances, engine);
    const b = await calculerTarif("classique", classicBody(), distances, rebuilt);
    assert.equal(a.tarif, b.tarif);
  });
});

describe("QA hardening — save réglages pro", () => {
  it("refuse settings.pricing avec oneWayPricePerKm = 0", () => {
    const result = validateTenantSettingsPayload({
      pricing: {
        classicTrip: {
          enabled: true,
          oneWayPricePerKm: 0,
          roundTripPricePerKm: 2,
          minimumPrice: 30,
          approachPricePerKm: 0.5,
          returnToBaseEnabled: true,
          outOfZoneMultiplier: 1.05,
        },
        hourlyHire: { enabled: true, hourlyRate: 80, minimumTotal: 200 },
        discounts: { roundTripEnabled: true },
      },
      contact: { address: { street: "1 rue Test, 76000 Rouen" } },
    });
    assert.equal(result.ok, false);
  });

  it("accepte un pricing pro cohérent avec le moteur default", () => {
    const result = validateTenantSettingsPayload({
      pricing: {
        classicTrip: {
          enabled: true,
          oneWayPricePerKm: 2,
          roundTripPricePerKm: 2,
          minimumPrice: 30,
          approachPricePerKm: 0.5,
          returnToBaseEnabled: true,
          outOfZoneMultiplier: 1.05,
          primaryServiceZoneSetId: "fr-76",
        },
        hourlyHire: { enabled: true, hourlyRate: 80, minimumTotal: 200 },
        discounts: { roundTripEnabled: true },
      },
      contact: { address: { street: "1 rue Test, 76000 Rouen" } },
    });
    assert.equal(result.ok, true);
  });
});
