import type { TenantPricingEngineConfig } from "./engineTypes";
import type { PricingConfigPayload } from "./payloadConfig.types";

function buildBandKey(fromKm?: number, toKm?: number): string {
  if (fromKm !== undefined && toKm !== undefined) return `${fromKm}-${toKm}`;
  if (fromKm !== undefined) return `+${fromKm}`;
  return "0-999999";
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
    const zoneIdNum = Number(band.zoneId);
    if (!Number.isFinite(zoneIdNum)) continue;
    zonesById.set(zoneIdNum, {
      min: band.minimumPrice,
      tarifsKm: {},
    });
  }

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const zoneId = parseZoneIdFromRuleIdOrLabel(rule);
    if (zoneId == null || !zonesById.has(zoneId)) continue;
    const key = buildBandKey(rule.fromKm, rule.toKm);
    zonesById.get(zoneId)!.tarifsKm[key] = rule.pricePerKm;
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
  const arZones = buildTcZones(payload.classicTrip.distanceRulesRoundTrip, payload.classicTrip.zoneBands);
  const { airports, taTable } = buildAirportsAndTaTable(payload);
  const roundTripDiscount = payload.discounts.find(
    (d) => d.enabled && d.trigger === "round_trip" && d.mode === "percent" && d.value > 0
  );

  const outOfPrimary = payload.classicTrip.outOfPrimaryZone;
  // TODO: mode=fixed_surcharge ne peut pas etre traduit 1:1 avec l'algo actuel (attend un multiplicateur).
  const outOfPrimaryMultiplier =
    outOfPrimary.mode === "multiplier" ? outOfPrimary.value : 1;

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
    outOfPrimaryServiceZoneMultiplier: outOfPrimaryMultiplier,
    primaryServiceZoneSetId: outOfPrimary.zoneSetId ?? "custom-payload",
    madHourlyRates: buildMadHourlyRates(payload),
    madEventMinimumTotal: payload.hourlyHire.minimumTotal ?? 0,
    // TODO: le payload v1 n'expose pas encore ce champ; valeur neutre conservée.
    calendarEventTitlePrefix: "Course VTC",
  };
}

