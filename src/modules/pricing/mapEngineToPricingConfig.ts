import type { TenantPricingEngineConfig } from "./engineTypes";
import type {
  AirportPriceRule,
  DiscountRule,
  DistanceRule,
  PricingConfigPayload,
  PricingCurrency,
  SurchargeRule,
  ZoneDistanceBand,
} from "./payloadConfig.types";

type MapEngineToPricingConfigOptions = {
  vtcBaseAddress?: string;
  timezone?: string;
  currency?: PricingCurrency;
};

function sortNumericStringsAsc(a: string, b: string): number {
  return Number(a) - Number(b);
}

function parseDistanceBand(key: string): { fromKm?: number; toKm?: number } {
  const trimmed = key.trim();
  if (trimmed.startsWith("+")) {
    const from = Number(trimmed.slice(1));
    return Number.isFinite(from) ? { fromKm: from } : {};
  }
  const m = /^(\d+)-(\d+)$/.exec(trimmed);
  if (!m) return {};
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return {};
  return { fromKm: from, toKm: to };
}

function buildZoneBands(tcZones: Record<number, { min: number }>): ZoneDistanceBand[] {
  const sortedZoneIds = Object.keys(tcZones).sort(sortNumericStringsAsc);
  return sortedZoneIds.map((zoneId, index) => {
    const currentZone = Number(zoneId);
    const nextZoneId = sortedZoneIds[index + 1];
    const minPrincipalDistanceKmByZone: Record<number, number> = {
      1: 0,
      2: 16,
      3: 36,
      4: 81,
      5: 121,
    };

    // TODO: ces seuils sont codés en dur dans l'algo actuel (zoneFromDistance).
    // Ils sont renseignés ici pour conserver un mapping explicite de l'état actuel.
    const maxPrincipalDistanceKm =
      nextZoneId === undefined
        ? undefined
        : Math.max(0, (minPrincipalDistanceKmByZone[Number(nextZoneId)] ?? 0) - 1);

    return {
      zoneId: String(currentZone),
      label: `Zone ${currentZone}`,
      minPrincipalDistanceKm: minPrincipalDistanceKmByZone[currentZone] ?? 0,
      maxPrincipalDistanceKm,
      minimumPrice: tcZones[currentZone].min,
      enabled: true,
    };
  });
}

function buildDistanceRules(
  tcZones: Record<number, { tarifsKm: Record<string, number> }>,
  tripKindLabel: "SIMPLE" | "AR"
): DistanceRule[] {
  const zoneIds = Object.keys(tcZones).sort(sortNumericStringsAsc);
  const rules: DistanceRule[] = [];
  for (const zoneId of zoneIds) {
    const zone = Number(zoneId);
    const tarifsKm = tcZones[zone].tarifsKm;
    const bandKeys = Object.keys(tarifsKm).sort((a, b) => {
      const pa = parseDistanceBand(a);
      const pb = parseDistanceBand(b);
      return (pa.fromKm ?? 0) - (pb.fromKm ?? 0);
    });
    for (const bandKey of bandKeys) {
      const parsed = parseDistanceBand(bandKey);
      rules.push({
        id: `${tripKindLabel.toLowerCase()}-zone-${zone}-${bandKey}`,
        label: `${tripKindLabel} zone ${zone} (${bandKey} km)`,
        fromKm: parsed.fromKm,
        toKm: parsed.toKm,
        pricePerKm: tarifsKm[bandKey],
        enabled: true,
      });
    }
  }
  return rules;
}

function buildAirportRules(engine: TenantPricingEngineConfig): AirportPriceRule[] {
  const airportCodes = Object.keys(engine.taTable).sort();
  return airportCodes.map((code) => {
    const airportDef = engine.airports[code];
    const simple = engine.taTable[code]?.SIMPLE ?? {};
    const ar = engine.taTable[code]?.ALLER_RETOUR ?? {};

    const mapBands = (bands: Record<string, { tarifKm: number; min: number }>) =>
      Object.keys(bands)
        .sort()
        .map((band) => {
          const [rawMin, rawMax] = band.split("-");
          const passengerMin = Number(rawMin);
          const passengerMax = Number(rawMax);
          return {
            passengerMin: Number.isFinite(passengerMin) ? passengerMin : 1,
            passengerMax: Number.isFinite(passengerMax) ? passengerMax : 4,
            pricePerKm: bands[band].tarifKm,
            minimumPrice: bands[band].min,
          };
        });

    return {
      id: `airport-${code.toLowerCase()}`,
      code,
      name: airportDef ? code : `Airport ${code}`,
      aliases: airportDef?.names ?? [code.toLowerCase()],
      address: airportDef?.address ?? code,
      oneWay: mapBands(simple),
      roundTrip: mapBands(ar),
      enabled: true,
    };
  });
}

function buildSurcharges(engine: TenantPricingEngineConfig): SurchargeRule[] {
  return [
    {
      id: "night-percent",
      label: "Majoration nuit",
      type: "night",
      mode: "percent",
      value: engine.maj.pctNight * 100,
      minAmount: engine.maj.minEuros,
      enabled: true,
    },
    {
      id: "evening-percent",
      label: "Majoration soiree",
      type: "evening",
      mode: "percent",
      value: engine.maj.pctEvening * 100,
      minAmount: engine.maj.minEuros,
      enabled: true,
    },
    {
      id: "weekend-percent",
      label: "Majoration week-end",
      type: "weekend",
      mode: "percent",
      value: engine.maj.pctWE * 100,
      minAmount: engine.maj.minEuros,
      enabled: true,
    },
    {
      id: "holiday-percent",
      label: "Majoration jour ferie",
      type: "holiday",
      mode: "percent",
      value: engine.maj.pctFerie * 100,
      minAmount: engine.maj.minEuros,
      enabled: true,
    },
  ];
}

function buildDiscounts(engine: TenantPricingEngineConfig): DiscountRule[] {
  return [
    {
      id: "round-trip-discount",
      label: "Remise aller-retour",
      trigger: "round_trip",
      mode: "percent",
      // L'algo actuel applique *0.95 si applyArDiscount=true.
      value: 5,
      enabled: engine.applyArDiscount,
    },
  ];
}

export function mapEngineToPricingConfig(
  engine: TenantPricingEngineConfig,
  options?: MapEngineToPricingConfigOptions
): PricingConfigPayload {
  const vtcBaseAddress = options?.vtcBaseAddress?.trim() || engine.depotAddress;
  const timezone = options?.timezone?.trim() || engine.timezone;
  const currency: PricingCurrency = options?.currency ?? "EUR";

  return {
    version: "v1",
    currency,
    timezone,
    vtcBaseAddress,
    publicHolidays: [...engine.publicHolidays],
    airportBuffers: { ...engine.airportBuffers },
    classicTrip: {
      enabled: true,
      zoneBands: buildZoneBands(engine.tcTable.SIMPLE.ZONES),
      distanceRulesOneWay: buildDistanceRules(engine.tcTable.SIMPLE.ZONES, "SIMPLE"),
      distanceRulesRoundTrip: buildDistanceRules(engine.tcTable.AR.ZONES, "AR"),
      approach: {
        enabled: true,
        mode: "min_of_approach_or_return_base",
        pricePerKm: engine.tcTable.SIMPLE.APPROCHE,
      },
      returnToBase: {
        enabled: true,
        mode: "min_of_approach_or_return_base",
        // L'algo actuel utilise le coef APPROCHE pour retour base.
        pricePerKm: engine.tcTable.SIMPLE.APPROCHE,
      },
      outOfPrimaryZone: {
        enabled: true,
        mode: "multiplier",
        value: engine.outOfPrimaryServiceZoneMultiplier,
        zoneSetId: engine.primaryServiceZoneSetId,
      },
      // TODO: l'algo actuel ajoute un supplément codé en dur (+0.2 / +0.1) selon distance.
      // Ce mapping l'expose explicitement pour préparer la future configuration payload-driven.
      supplementShortDistance: {
        enabled: true,
        fromKm: 1,
        toKm: 50,
        addPricePerKm: 0.2,
      },
    },
    airportTransfers: {
      enabled: true,
      rules: buildAirportRules(engine),
      fallbackAirportCode: "ORY",
    },
    hourlyHire: {
      enabled: true,
      minimumTotal: engine.madEventMinimumTotal,
      rateRules: [
        {
          id: "hourly-default",
          label: "Taux horaire standard",
          hourlyRate: engine.madHourlyRates.default,
          enabled: true,
        },
        {
          id: "hourly-evening-night",
          label: "Taux horaire soiree/nuit",
          startsAtHour: 19,
          hourlyRate: engine.madHourlyRates.eveningOrNight,
          enabled: true,
        },
        {
          id: "hourly-weekend-holiday",
          label: "Taux horaire week-end/ferie",
          appliesOnWeekend: true,
          appliesOnHoliday: true,
          hourlyRate: engine.madHourlyRates.weekendOrHoliday,
          enabled: true,
        },
      ],
    },
    surcharges: buildSurcharges(engine),
    discounts: buildDiscounts(engine),
    cityRules: [],
    options: [],
    passengerBagPolicy: {
      minPassengers: 1,
      maxPassengers: 4,
      bagPricingEnabled: false,
    },
    rounding: {
      classic: "ceil",
      airport: "ceil_to_5",
      hourlyHire: "ceil",
    },
  };
}

