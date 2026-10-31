/**
 * Construit un PricingConfigPayload minimal à partir des réglages pro simplifiés
 * (`settings.pricing`) afin de rejouer `validatePricingConfigPayload` à la sauvegarde.
 */
import defaultEngineJson from "../../config/tenants/engines/default.engine.json";
import type { PricingConfigPayload } from "./payloadConfig.types";
import { mapEngineToPricingConfig } from "./mapEngineToPricingConfig";
import type { TenantPricingEngineConfig } from "./engineTypes";

type ProClassic = {
  enabled?: boolean;
  oneWayPricePerKm?: number;
  roundTripPricePerKm?: number;
  minimumPrice?: number;
  approachPricePerKm?: number;
  returnToBaseEnabled?: boolean;
  outOfZoneMultiplier?: number;
  primaryServiceZoneSetId?: string;
};

type ProAirport = {
  code?: string;
  name?: string;
  address?: string;
  pricePerKm?: number;
  oneWayMinimumPrice?: number;
  roundTripMinimumPrice?: number;
  enabled?: boolean;
};

type ProPricing = {
  classicTrip?: ProClassic;
  airportTransfers?: { enabled?: boolean; airports?: ProAirport[] };
  hourlyHire?: { enabled?: boolean; hourlyRate?: number; minimumTotal?: number };
  discounts?: { roundTripEnabled?: boolean };
  cityRules?: PricingConfigPayload["cityRules"];
};

function loadDefaultEngine(): TenantPricingEngineConfig {
  return defaultEngineJson as unknown as TenantPricingEngineConfig;
}

function resolveVtcBase(settings: Record<string, unknown>, engine: TenantPricingEngineConfig): string {
  const calc = settings.calculatorDisplay as { vtcBaseAddress?: string } | undefined;
  const fromCalc = calc?.vtcBaseAddress?.trim();
  if (fromCalc) return fromCalc;
  const contact = settings.contact as { address?: { street?: string } } | undefined;
  const street = contact?.address?.street?.trim();
  if (street) return street;
  return engine.depotAddress || "France";
}

/**
 * Overlay des champs pro simplifiés sur un payload issu du moteur `default`.
 * Si `settings.pricing` est absent, retourne null (pas de validation pricing à appliquer).
 */
export function buildPricingConfigFromProSettings(
  settings: Record<string, unknown>
): PricingConfigPayload | null {
  if (settings.pricingConfig != null && typeof settings.pricingConfig === "object") {
    return settings.pricingConfig as PricingConfigPayload;
  }

  const pricing = settings.pricing as ProPricing | undefined;
  if (pricing == null || typeof pricing !== "object") return null;

  const engine = loadDefaultEngine();
  const base = mapEngineToPricingConfig(engine, {
    vtcBaseAddress: resolveVtcBase(settings, engine),
  });

  const classic = pricing.classicTrip ?? {};
  if (typeof classic.oneWayPricePerKm === "number") {
    for (const rule of base.classicTrip.distanceRulesOneWay) {
      rule.pricePerKm = classic.oneWayPricePerKm;
      if (typeof classic.minimumPrice === "number") rule.minimumPrice = classic.minimumPrice;
    }
  }
  if (typeof classic.roundTripPricePerKm === "number") {
    for (const rule of base.classicTrip.distanceRulesRoundTrip) {
      rule.pricePerKm = classic.roundTripPricePerKm;
      if (typeof classic.minimumPrice === "number") rule.minimumPrice = classic.minimumPrice;
    }
  }
  if (typeof classic.minimumPrice === "number") {
    for (const band of base.classicTrip.zoneBands) band.minimumPrice = classic.minimumPrice;
  }
  if (typeof classic.approachPricePerKm === "number") {
    base.classicTrip.approach.pricePerKm = classic.approachPricePerKm;
    base.classicTrip.returnToBase.pricePerKm = classic.approachPricePerKm;
  }
  if (typeof classic.returnToBaseEnabled === "boolean") {
    base.classicTrip.returnToBase.enabled = classic.returnToBaseEnabled;
    base.classicTrip.returnToBase.mode = classic.returnToBaseEnabled ? "always_return_base" : "none";
  }
  if (typeof classic.outOfZoneMultiplier === "number") {
    base.classicTrip.outOfPrimaryZone.value = classic.outOfZoneMultiplier;
  }
  if (typeof classic.primaryServiceZoneSetId === "string" && classic.primaryServiceZoneSetId.trim()) {
    base.classicTrip.outOfPrimaryZone.zoneSetId = classic.primaryServiceZoneSetId.trim();
  }
  if (typeof classic.enabled === "boolean") {
    base.classicTrip.enabled = classic.enabled;
  }

  const airports = pricing.airportTransfers?.airports;
  if (Array.isArray(airports) && airports.length > 0) {
    base.airportTransfers.enabled = pricing.airportTransfers?.enabled ?? true;
    base.airportTransfers.rules = airports.map((a, idx) => {
      const code = (a.code || `A${idx}`).toUpperCase();
      const pricePerKm = Number(a.pricePerKm);
      const oneMin = Number(a.oneWayMinimumPrice);
      const arMin = Number(a.roundTripMinimumPrice);
      return {
        id: `airport-${code.toLowerCase()}`,
        code,
        name: a.name || code,
        aliases: [code.toLowerCase()],
        address: a.address || code,
        enabled: a.enabled !== false,
        oneWay: [
          { passengerMin: 1, passengerMax: 2, pricePerKm, minimumPrice: oneMin },
          { passengerMin: 3, passengerMax: 4, pricePerKm, minimumPrice: oneMin },
        ],
        roundTrip: [
          { passengerMin: 1, passengerMax: 2, pricePerKm, minimumPrice: arMin },
          { passengerMin: 3, passengerMax: 4, pricePerKm, minimumPrice: arMin },
        ],
      };
    });
  } else if (typeof pricing.airportTransfers?.enabled === "boolean") {
    base.airportTransfers.enabled = pricing.airportTransfers.enabled;
  }

  const hourly = pricing.hourlyHire;
  if (hourly) {
    if (typeof hourly.enabled === "boolean") base.hourlyHire.enabled = hourly.enabled;
    if (typeof hourly.minimumTotal === "number") base.hourlyHire.minimumTotal = hourly.minimumTotal;
    if (typeof hourly.hourlyRate === "number") {
      for (const rule of base.hourlyHire.rateRules) rule.hourlyRate = hourly.hourlyRate;
    }
  }

  if (pricing.discounts && typeof pricing.discounts.roundTripEnabled === "boolean") {
    for (const d of base.discounts) {
      if (d.trigger === "round_trip") d.enabled = pricing.discounts.roundTripEnabled;
    }
  }

  if (Array.isArray(pricing.cityRules)) {
    base.cityRules = pricing.cityRules;
  }

  return base;
}
