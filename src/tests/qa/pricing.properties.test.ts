/**
 * QA Passe 2 — propriétés tarifaires (fast-check) + golden master.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import { calculerTarif } from "../../modules/pricing";
import { applyVehicleToResult } from "../../modules/pricing/vehicleSurchargeApply";
import type { TenantPricingEngineConfig } from "../../modules/pricing/engineTypes";

const engine = JSON.parse(
  readFileSync("./src/config/tenants/engines/default.engine.json", "utf8")
) as TenantPricingEngineConfig;

function dist(km: number) {
  const duree = Math.round(km * 60);
  return {
    aller: {
      approche: { km: 5, duree: 600 },
      trajet: { km, duree },
      retourBase: { km: 5, duree: 600 },
    },
    retour: {
      approche: { km: 5, duree: 600 },
      trajet: { km, duree },
      retourBase: { km: 5, duree: 600 },
    },
  };
}

function asBody(date = "15/05/2026", heure = "12:00") {
  return {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "75001 Paris",
      TCallerdate: date,
      TCallerheure: heure,
    },
  };
}

function arBody(date = "15/05/2026") {
  return {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller/Retour",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "75001 Paris",
      TCallerdate: date,
      TCallerheure: "10:00",
      TCretourdate: date,
      TCretourheure: "18:00",
    },
  };
}

describe("QA Passe 2 — propriétés tarifaires", () => {
  // BUG MAJEUR confirmé (contre-exemple 199→201 km : 403 € → 365 €) :
  // les paliers de grille km (€/km décroissants) + ceil peuvent faire baisser le total
  // quand on allonge le trajet. Correctif proposé : contrainte de monotonie
  // (max(tarif(km), tarif(km-ε))) ou lissage des paliers.
  it(
    "trajet plus long ne coûte jamais moins cher (AS, même créneau)",
    { todo: "non-monotonie grille km : 199km=403€ > 201km=365€ — ne pas corriger ici" },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 100 }), async (km, delta) => {
          const a = await calculerTarif("classique", asBody(), dist(km), engine);
          const b = await calculerTarif("classique", asBody(), dist(km + delta), engine);
          assert.ok(b.tarif >= a.tarif, `${km}+${delta}km → ${b.tarif} < ${a.tarif}`);
        }),
        { numRuns: 40 }
      );
    }
  );

  it("repro figée non-monotonie 199 vs 201 km (documente le bug)", async () => {
    const a = await calculerTarif("classique", asBody(), dist(199), engine);
    const b = await calculerTarif("classique", asBody(), dist(201), engine);
    // Assertion qui DOIT rester vraie tant que le bug existe — filet anti-« faux correctif silencieux ».
    assert.ok(
      a.tarif > b.tarif,
      `attendu bug : 199km (${a.tarif}) > 201km (${b.tarif}) ; si égalité/inversé, revoir le correctif monotonie`
    );
  });

  it("total toujours > 0", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 500 }), async (km) => {
        const r = await calculerTarif("classique", asBody(), dist(km), engine);
        assert.ok(r.tarif > 0);
      }),
      { numRuns: 30 }
    );
  });

  it("AR avec remise jamais plus cher que 2 allers simples", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 20, max: 300 }), async (km) => {
        const as = await calculerTarif("classique", asBody(), dist(km), engine);
        const ar = await calculerTarif("classique", arBody(), dist(km), engine);
        assert.ok(
          ar.tarif <= as.tarif * 2 + 1e-9,
          `AR ${ar.tarif} > 2×AS ${as.tarif * 2} (km=${km})`
        );
      }),
      { numRuns: 25 }
    );
  });

  it("supplément véhicule ne diminue jamais le prix", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 30, max: 250 }),
        fc.constantFrom(
          { mode: "fixed" as const, value: 0 },
          { mode: "fixed" as const, value: 50 },
          { mode: "per_km" as const, value: 0.5 },
          { mode: "percent_km" as const, value: 10 },
          { mode: "none" as const, value: 0 }
        ),
        async (km, surcharge) => {
          const r = await calculerTarif("classique", asBody(), dist(km), engine);
          const base = r.tarif;
          applyVehicleToResult(r, {
            id: "v",
            name: "V",
            passengerMax: 4,
            surchargeMode: surcharge.mode,
            surchargeValue: surcharge.value,
          });
          assert.ok(r.tarif >= base);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("mêmes entrées = même prix (déterminisme)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 10, max: 300 }), async (km) => {
        const a = await calculerTarif("classique", asBody(), dist(km), engine);
        const b = await calculerTarif("classique", asBody(), dist(km), engine);
        assert.equal(a.tarif, b.tarif);
      }),
      { numRuns: 20 }
    );
  });
});

describe("QA Passe 2 — golden master tarifs", () => {
  it("chaque cas figé conserve son prix", async () => {
    const golden = JSON.parse(
      readFileSync("./src/tests/qa/fixtures/pricing-golden.json", "utf8")
    ) as {
      cases: Array<{
        id: string;
        type: "classique" | "aeroport" | "mad-evenementiel";
        body: Record<string, unknown>;
        distances: never;
        vehicle?: {
          id: string;
          name: string;
          passengerMax: number;
          surchargeMode: "none" | "fixed" | "per_km" | "percent_km";
          surchargeValue: number;
        };
        expectedTarif: number;
      }>;
    };
    assert.ok(golden.cases.length >= 60, `attendu ≥60 cas, got ${golden.cases.length}`);

    const drifts: string[] = [];
    for (const c of golden.cases) {
      const result = await calculerTarif(c.type, c.body, c.distances, engine);
      if (c.vehicle) {
        applyVehicleToResult(result, c.vehicle);
      }
      if (result.tarif !== c.expectedTarif) {
        drifts.push(`${c.id}: attendu ${c.expectedTarif}, obtenu ${result.tarif}`);
      }
    }
    assert.equal(drifts.length, 0, `dérive tarifaire:\n${drifts.join("\n")}`);
  });
});
