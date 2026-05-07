import defaultEngineJson from "../config/tenants/engines/default.engine.json";
import { parsePricingEngineJson } from "../config/tenants/engineSchema";
import {
  mapEngineToPricingConfig,
  mapPricingConfigToEngine,
  validatePricingConfigPayload,
} from "../modules/pricing";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function main() {
  const originalEngine = parsePricingEngineJson(defaultEngineJson);

  const pricingConfig = mapEngineToPricingConfig(originalEngine, {
    vtcBaseAddress: "Paris, France",
    timezone: originalEngine.timezone,
    currency: "EUR",
  });

  const validatedPricingConfig = validatePricingConfigPayload(pricingConfig);
  const roundtripEngine = mapPricingConfigToEngine(validatedPricingConfig);

  assert(Boolean(roundtripEngine.tcTable?.SIMPLE?.ZONES), "tcTable.SIMPLE.ZONES manquant");
  assert(Boolean(roundtripEngine.tcTable?.AR?.ZONES), "tcTable.AR.ZONES manquant");
  assert(Boolean(roundtripEngine.taTable), "taTable manquant");
  assert(Boolean(roundtripEngine.airports), "airports manquant");
  assert(Boolean(roundtripEngine.madHourlyRates), "madHourlyRates manquant");
  assert(Array.isArray(roundtripEngine.publicHolidays), "publicHolidays manquant");

  console.log("[verifyPricingConfigRoundtrip] OK");
  console.log(
    JSON.stringify(
      {
        timezone: roundtripEngine.timezone,
        tcSimpleZones: Object.keys(roundtripEngine.tcTable.SIMPLE.ZONES).length,
        tcArZones: Object.keys(roundtripEngine.tcTable.AR.ZONES).length,
        airports: Object.keys(roundtripEngine.airports).length,
        taTable: Object.keys(roundtripEngine.taTable).length,
      },
      null,
      2
    )
  );
}

main();

