import type { TenantPricingEngineConfig } from "./engineTypes";
import type { PricingConfigPayload } from "./payloadConfig.types";
import { getPrimaryServiceZoneCommunes } from "./zoneSets/registry";

/** Aligné sur `default.engine.json` et `buildPricingConfigForTenant` si `zoneSetId` est absent du payload. */
const DEFAULT_LEGACY_PRIMARY_ZONE_SET_ID = "fr-76";

function resolveOutOfPrimaryZoneEngineParams(
  outOfPrimary: PricingConfigPayload["classicTrip"]["outOfPrimaryZone"]
): { multiplier: number; zoneSetId: string } {
  const configuredMult =
    !outOfPrimary.enabled ? 1 : outOfPrimary.mode === "multiplier" ? outOfPrimary.value : 1;

  const trimmed = outOfPrimary.zoneSetId?.trim();
  if (trimmed && getPrimaryServiceZoneCommunes(trimmed) !== undefined) {
    return { multiplier: configuredMult, zoneSetId: trimmed };
  }

  if (!trimmed) {
    return { multiplier: configuredMult, zoneSetId: DEFAULT_LEGACY_PRIMARY_ZONE_SET_ID };
  }

  /* Identifiant inconnu du registre : ne pas appliquer ×valeur à toutes les courses. */
  return { multiplier: 1, zoneSetId: trimmed };
}

/** Tranches lues par `kmTarifClassique` dans calculator.ts */
const STANDARD_KM_BAND_KEYS = ["1-50", "51-90", "91-150", "+150", "91-200", "+200"] as const;

function buildBandKey(fromKm?: number, toKm?: number): string {
  if (fromKm !== undefined && toKm !== undefined) return `${fromKm}-${toKm}`;
  if (fromKm !== undefined) return `+${fromKm}`;
  return "0-999999";
}

function resolveZoneIdFromBand(zoneId: string): number {
  const num = Number(zoneId);
  if (Number.isFinite(num) && num >= 1) return Math.floor(num);
  return 1;
}

function parseZoneIdFromRuleIdOrLabel(rule: { id: string; label: string }): number | null {
  const idMatch = /zone-(\d+)/i.exec(rule.id);
  if (idMatch) return Number(idMatch[1]);
  const labelMatch = /zone\s+(\d+)/i.exec(rule.label);
  if (labelMatch) return Number(labelMatch[1]);
  return null;
}

function buildTcZones(
  rules: PricingConfigPayload["classicTrip"]["distanceRulesOneWay"],
  zoneBands: PricingConfigPayload["classicTrip"]["zoneBands"]
): Record<number, { min: number; tarifsKm: Record<string, number> }> {
  const zonesById = new Map<number, { min: number; tarifsKm: Record<string, number> }>();

  for (const band of zoneBands) {
    const zoneIdNum = resolveZoneIdFromBand(band.zoneId);
    const existing = zonesById.get(zoneIdNum);
    zonesById.set(zoneIdNum, {
      min: Math.max(existing?.min ?? 0, band.minimumPrice),
      tarifsKm: existing?.tarifsKm ?? {},
    });
  }

  for (const rule of rules) {
    if (!rule.enabled) continue;
    let zoneId = parseZoneIdFromRuleIdOrLabel(rule);
    if (zoneId == null) zoneId = 1;

    if (!zonesById.has(zoneId)) {
      zonesById.set(zoneId, {
        min: rule.minimumPrice ?? 0,
        tarifsKm: {},
      });
    } else {
      const z = zonesById.get(zoneId)!;
      z.min = Math.max(z.min, rule.minimumPrice ?? 0);
    }

    const zone = zonesById.get(zoneId)!;
    const key = buildBandKey(rule.fromKm, rule.toKm);
    if (rule.fromKm === undefined && rule.toKm === undefined) {
      for (const bandKey of STANDARD_KM_BAND_KEYS) {
        zone.tarifsKm[bandKey] = rule.pricePerKm;
      }
    } else {
      zone.tarifsKm[key] = rule.pricePerKm;
    }
  }

  const out: Record<number, { min: number; tarifsKm: Record<string, number> }> = {};
  for (const [zoneId, value] of zonesById.entries()) {
    out[zoneId] = value;
  }
  return out;
}

function buildMaj(payload: PricingConfigPayload): TenantPricingEngineConfig["maj"] {
  const maj = {
    pctNight: 0,
    pctEvening: 0,
    pctWE: 0,
    pctFerie: 0,
    minEuros: 0,
  };

  for (const s of payload.surcharges) {
    if (!s.enabled) continue;
    const ratio = s.mode === "percent" ? s.value / 100 : 0;
    if (s.type === "night") maj.pctNight = ratio;
    if (s.type === "evening") maj.pctEvening = ratio;
    if (s.type === "weekend") maj.pctWE = ratio;
    if (s.type === "holiday") maj.pctFerie = ratio;
    if (typeof s.minAmount === "number") {
      maj.minEuros = Math.max(maj.minEuros, s.minAmount);
    }
  }
  return maj;
}

function buildMadHourlyRates(payload: PricingConfigPayload): TenantPricingEngineConfig["madHourlyRates"] {
  const defaultRule = payload.hourlyHire.rateRules.find((r) => r.id === "hourly-default") ?? payload.hourlyHire.rateRules[0];
  const eveningRule = payload.hourlyHire.rateRules.find((r) => r.id === "hourly-evening-night");
  const weekendRule = payload.hourlyHire.rateRules.find((r) => r.id === "hourly-weekend-holiday");

  const fallback = defaultRule?.hourlyRate ?? 0;
  return {
    default: fallback,
    eveningOrNight: eveningRule?.hourlyRate ?? fallback,
    weekendOrHoliday: weekendRule?.hourlyRate ?? fallback,
  };
}

function buildAirportsAndTaTable(payload: PricingConfigPayload): {
  airports: TenantPricingEngineConfig["airports"];
  taTable: TenantPricingEngineConfig["taTable"];
} {
  const airports: TenantPricingEngineConfig["airports"] = {};
  const taTable: TenantPricingEngineConfig["taTable"] = {};

  for (const rule of payload.airportTransfers.rules) {
    if (!rule.enabled) continue;
    airports[rule.code] = {
      names: [...rule.aliases],
      address: rule.address,
    };
    taTable[rule.code] = {
      SIMPLE: {},
      ALLER_RETOUR: {},
    };
    for (const one of rule.oneWay) {
      const key = `${one.passengerMin}-${one.passengerMax}`;
      taTable[rule.code].SIMPLE[key] = {
        tarifKm: one.pricePerKm,
        min: one.minimumPrice,
      };
    }
    for (const ar of rule.roundTrip) {
      const key = `${ar.passengerMin}-${ar.passengerMax}`;
      taTable[rule.code].ALLER_RETOUR[key] = {
        tarifKm: ar.pricePerKm,
        min: ar.minimumPrice,
      };
    }
  }

  return { airports, taTable };
}

export function mapPricingConfigToEngine(payload: PricingConfigPayload): TenantPricingEngineConfig {
  const simpleZones = buildTcZones(payload.classicTrip.distanceRulesOneWay, payload.classicTrip.zoneBands);
  const arZoneBands = payload.classicTrip.zoneBandsRoundTrip ?? payload.classicTrip.zoneBands;
  const arZones = buildTcZones(payload.classicTrip.distanceRulesRoundTrip, arZoneBands);
  const { airports, taTable } = buildAirportsAndTaTable(payload);
  const roundTripDiscount = payload.discounts.find(
    (d) => d.enabled && d.trigger === "round_trip" && d.mode === "percent" && d.value > 0
  );

  const outOfPrimary = payload.classicTrip.outOfPrimaryZone;
  const outPrimaryResolved = resolveOutOfPrimaryZoneEngineParams(outOfPrimary);
  return {
    timezone: payload.timezone,
    depotAddress: payload.vtcBaseAddress,
    publicHolidays: [...payload.publicHolidays],
    airportBuffers: payload.airportBuffers ?? {
      default: { preFlightMin: 120, arrivalMin: 30, dropoffMarginMin: 10 },
    },
    airports,
    taTable,
    tcTable: {
      SIMPLE: {
        ZONES: simpleZones,
        APPROCHE: payload.classicTrip.approach.pricePerKm,
      },
      AR: {
        ZONES: arZones,
        APPROCHE: payload.classicTrip.approach.pricePerKm,
      },
    },
    maj: buildMaj(payload),
    applyArDiscount: Boolean(roundTripDiscount),
    arDiscountPercent:
      roundTripDiscount && roundTripDiscount.mode === "percent"
        ? Math.min(100, Math.max(0, roundTripDiscount.value))
        : 0,
    outOfPrimaryServiceZoneMultiplier: outPrimaryResolved.multiplier,
    returnToBaseEnabled:
      payload.classicTrip.returnToBase.enabled &&
      payload.classicTrip.returnToBase.mode !== "none",
    primaryServiceZoneSetId: outPrimaryResolved.zoneSetId,
    madHourlyRates: buildMadHourlyRates(payload),
    madEventMinimumTotal: payload.hourlyHire.minimumTotal ?? 0,
    // TODO: le payload v1 n'expose pas encore ce champ; valeur neutre conservée.
    calendarEventTitlePrefix: "Course VTC",
  };
}

