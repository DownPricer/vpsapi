export type PricingCurrency = "EUR";
export type PricingConfigVersion = "v1";
export type MoneyMode = "fixed" | "percent";
export type RoundingMode = "ceil" | "nearest" | "ceil_to_5";

export type DistanceRule = {
  id: string;
  label: string;
  fromKm?: number;
  toKm?: number;
  pricePerKm: number;
  minimumPrice?: number;
  enabled: boolean;
};

export type ApproachConfig = {
  enabled: boolean;
  mode: "min_of_approach_or_return_base" | "always_approach" | "none";
  pricePerKm: number;
};

export type ReturnBaseConfig = {
  enabled: boolean;
  mode: "min_of_approach_or_return_base" | "always_return_base" | "none";
  pricePerKm: number;
};

export type ZoneDistanceBand = {
  zoneId: string;
  label: string;
  minPrincipalDistanceKm: number;
  maxPrincipalDistanceKm?: number;
  minimumPrice: number;
  enabled: boolean;
};

export type OutOfZoneRule = {
  enabled: boolean;
  mode: "multiplier" | "fixed_surcharge";
  value: number;
  primaryCities?: string[];
  zoneSetId?: string;
};

export type AirportPriceRule = {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  address: string;
  oneWay: Array<{
    passengerMin: number;
    passengerMax: number;
    pricePerKm: number;
    minimumPrice: number;
  }>;
  roundTrip: Array<{
    passengerMin: number;
    passengerMax: number;
    pricePerKm: number;
    minimumPrice: number;
  }>;
  enabled: boolean;
};

export type HourlyHireRule = {
  id: string;
  label: string;
  startsAtHour?: number;
  endsAtHour?: number;
  appliesOnWeekend?: boolean;
  appliesOnHoliday?: boolean;
  hourlyRate: number;
  enabled: boolean;
};

export type SurchargeRule = {
  id: string;
  label: string;
  type: "night" | "evening" | "weekend" | "holiday" | "custom";
  mode: MoneyMode;
  value: number;
  minAmount?: number;
  priority?: number;
  enabled: boolean;
};

export type DiscountRule = {
  id: string;
  label: string;
  trigger: "round_trip" | "city" | "custom";
  mode: MoneyMode;
  value: number;
  enabled: boolean;
};

export type CityRule = {
  id: string;
  city: string;
  postalCode?: string;
  type: "discount" | "fixed_price" | "surcharge" | "excluded";
  value?: number;
  note?: string;
  enabled: boolean;
};

export type OptionRule = {
  id: string;
  label: string;
  mode: MoneyMode;
  value: number;
  per: "booking" | "passenger" | "bag" | "hour";
  enabled: boolean;
};

export type PassengerBagPolicy = {
  minPassengers: number;
  maxPassengers: number;
  bagPricingEnabled: boolean;
  includedBags?: number;
  extraBagPrice?: number;
};

export type PricingConfigPayload = {
  version: PricingConfigVersion;
  currency: PricingCurrency;
  timezone: string;

  vtcBaseAddress: string;
  publicHolidays: string[];
  airportBuffers?: Record<string, { preFlightMin: number; arrivalMin: number; dropoffMarginMin: number }>;

  classicTrip: {
    enabled: boolean;
    zoneBands: ZoneDistanceBand[];
    distanceRulesOneWay: DistanceRule[];
    distanceRulesRoundTrip: DistanceRule[];
    /**
     * Bandeaux de zone pour les minimums / grilles **aller-retour** (tcTable.AR).
     * Si absent, on retombe sur `zoneBands` (risque d’écarts vs moteur JSON si SIMPLE.min ≠ AR.min).
     */
    zoneBandsRoundTrip?: ZoneDistanceBand[];
    approach: ApproachConfig;
    returnToBase: ReturnBaseConfig;
    outOfPrimaryZone: OutOfZoneRule;
    supplementShortDistance?: {
      enabled: boolean;
      fromKm: number;
      toKm: number;
      addPricePerKm: number;
    };
  };

  airportTransfers: {
    enabled: boolean;
    rules: AirportPriceRule[];
    fallbackAirportCode?: string;
  };

  hourlyHire: {
    enabled: boolean;
    minimumTotal?: number;
    rateRules: HourlyHireRule[];
  };

  surcharges: SurchargeRule[];
  discounts: DiscountRule[];
  cityRules: CityRule[];
  options: OptionRule[];
  passengerBagPolicy?: PassengerBagPolicy;
  rounding: {
    classic: RoundingMode;
    airport: RoundingMode;
    hourlyHire: RoundingMode;
  };
};

