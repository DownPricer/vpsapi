import defaultEngineJson from "../config/tenants/engines/default.engine.json";
import { parsePricingEngineJson } from "../config/tenants/engineSchema";
import {
  mapEngineToPricingConfig,
  validatePricingConfigPayload,
} from "../modules/pricing";

function main() {
  const engine = parsePricingEngineJson(defaultEngineJson);
  const mapped = mapEngineToPricingConfig(engine, {
    // `default.engine.json` ne contient pas `depotAddress` (injecté par engineLoader en runtime).
    // On fournit une valeur explicite pour la vérification hors runtime tenant.
    vtcBaseAddress: "Paris, France",
    timezone: engine.timezone,
    currency: "EUR",
  });

  const validated = validatePricingConfigPayload(mapped);
  const requiredSections: Array<keyof typeof validated> = [
    "classicTrip",
    "airportTransfers",
    "hourlyHire",
    "surcharges",
    "discounts",
    "publicHolidays",
  ];

  const missing = requiredSections.filter((key) => validated[key] == null);
  if (missing.length > 0) {
    throw new Error(`Sections manquantes apres validation: ${missing.join(", ")}`);
  }

  // Vérification volontairement simple pour cette PR préparatoire.
  console.log("[verifyPricingConfigMapping] OK");
  console.log(
    JSON.stringify(
      {
        version: validated.version,
        currency: validated.currency,
        timezone: validated.timezone,
        sections: requiredSections,
      },
      null,
      2
    )
  );
}

main();

