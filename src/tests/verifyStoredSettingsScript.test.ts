import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { describe, it } from "node:test";
import { validateTenantSettingsPayload } from "../validation/tenantSettingsPayload";

describe("verify:stored-settings — fichiers locaux connus", () => {
  it("tenant-marketing-defaults.json passe (ou échoue de façon structurée sans dump)", () => {
    const raw = JSON.parse(
      readFileSync("./src/scripts/data/tenant-marketing-defaults.json", "utf8")
    ) as unknown;
    const result = validateTenantSettingsPayload(raw);
    // Le script de vérif doit pouvoir formater le résultat ; on documente le statut.
    if (!result.ok) {
      assert.ok(result.message.length > 0);
      assert.equal(typeof result.message, "string");
      // Pas de contenu settings dans le message
      assert.equal(JSON.stringify(result).includes("Exemple VTC"), false);
    } else {
      assert.equal(result.ok, true);
    }
  });

  it("refuse un pricing toxique (régression LOT 2)", () => {
    const bad = {
      pricing: {
        classicTrip: {
          oneWayPricePerKm: 0,
          roundTripPricePerKm: 2,
          minimumPrice: 50,
        },
      },
    };
    const result = validateTenantSettingsPayload(bad);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /tarifaire|pricing/i);
    }
  });
});
