import assert from "node:assert/strict";
import { describe, it } from "node:test";
import defaultEngineJson from "../config/tenants/engines/default.engine.json";
import { parsePricingEngineJson } from "../config/tenants/engineSchema";
import { calculerTarif } from "../modules/pricing/calculator";
import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";
import type { Distances, TarifResult } from "../modules/pricing/types";
import { computeVehicleSurcharge, describeSurcharge } from "../modules/pricing/vehicleSurcharge";
import { applyVehicleToResult, type VehicleForPricing } from "../modules/pricing/vehicleSurchargeApply";

const baseEngine = parsePricingEngineJson(defaultEngineJson) as TenantPricingEngineConfig;
const engineWith = (patch: Partial<TenantPricingEngineConfig>): TenantPricingEngineConfig => ({
  ...structuredClone(baseEngine),
  depotAddress: baseEngine.depotAddress?.trim() ? baseEngine.depotAddress : "Dépôt test, 76000 Rouen, France",
  ...patch,
});

const leg = (a: number, t: number, r: number): Distances["aller"] => ({
  approche: { km: a, duree: a * 60 },
  trajet: { km: t, duree: t * 60 },
  retourBase: { km: r, duree: r * 60 },
});
const none = leg(0, 0, 0);

const vehicle = (mode: VehicleForPricing["surchargeMode"], value: number): VehicleForPricing => ({
  id: "veh_test",
  name: "Mercedes Classe V",
  passengerMax: 7,
  surchargeMode: mode,
  surchargeValue: value,
});

const classique = (tct: string, extra: Record<string, string> = {}): Record<string, unknown> => ({
  general: { TypeService: "Trajet Classique" },
  trajetClassique: {
    TCtrajet: tct,
    TCallerpriseencharge: "1 rue test, 76300 Bihorel, France",
    TCallerDestination: "5 avenue test, 76000 Rouen, France",
    TCallerdate: "10/05/2026",
    TCallerheure: "14:30",
    TCretourpriseencharge: "5 avenue test, 76000 Rouen, France",
    TCretourDestination: "1 rue test, 76300 Bihorel, France",
    TCretourdate: "10/05/2026",
    TCretourheure: "18:30",
    ...extra,
  },
});

async function run(
  type: "classique" | "aeroport" | "mad-evenementiel",
  payload: Record<string, unknown>,
  distances: Distances,
  engine = engineWith({})
): Promise<TarifResult> {
  return calculerTarif(type, payload, distances, engine);
}

describe("computeVehicleSurcharge (formules)", () => {
  const basis = { kmApplicable: true, billableKm: 80, kmAmount: 160 };

  it("aucun supplément", () => {
    const r = computeVehicleSurcharge({ mode: "none", value: 0 }, basis);
    assert.equal(r.amount, 0);
  });
  it("fixe : +50 €", () => {
    assert.equal(computeVehicleSurcharge({ mode: "fixed", value: 50 }, basis).amount, 50);
  });
  it("par km : 80 km × 0,50 €/km = 40 €", () => {
    assert.equal(computeVehicleSurcharge({ mode: "per_km", value: 0.5 }, basis).amount, 40);
  });
  it("pourcentage : +20 % de la composante kilométrique (2 €/km × 80 km = 160 €) = 32 €, appliqué une seule fois", () => {
    const r = computeVehicleSurcharge({ mode: "percent_km", value: 20 }, basis);
    assert.equal(r.amount, 32);
    // pas de double multiplication par les km (80 × 32 serait l'erreur à éviter)
    assert.notEqual(r.amount, 80 * 32);
  });
  it("arrondi à l'euro supérieur pour les montants calculés (cohérent avec Math.ceil du moteur)", () => {
    assert.equal(computeVehicleSurcharge({ mode: "per_km", value: 0.5 }, { kmApplicable: true, billableKm: 3, kmAmount: 6 }).amount, 2);
    assert.equal(computeVehicleSurcharge({ mode: "percent_km", value: 20 }, { kmApplicable: true, billableKm: 10, kmAmount: 187.43 }).amount, 38);
  });
  it("valeurs négatives ou invalides ignorées (jamais de remise via le supplément)", () => {
    assert.equal(computeVehicleSurcharge({ mode: "fixed", value: -100 }, basis).amount, 0);
    assert.equal(computeVehicleSurcharge({ mode: "percent_km", value: Number.NaN }, basis).amount, 0);
  });
  it("sans composante kilométrique : km et % valent 0 et expliquent pourquoi, fixe reste applicable", () => {
    const mad = { kmApplicable: false, billableKm: 0, kmAmount: 0 };
    const perKm = computeVehicleSurcharge({ mode: "per_km", value: 1 }, mad);
    assert.equal(perKm.amount, 0);
    assert.equal(perKm.applicable, false);
    assert.ok(perKm.note);
    assert.equal(computeVehicleSurcharge({ mode: "percent_km", value: 30 }, mad).amount, 0);
    assert.equal(computeVehicleSurcharge({ mode: "fixed", value: 25 }, mad).amount, 25);
  });
  it("phrases d'aide", () => {
    assert.equal(describeSurcharge({ mode: "fixed", value: 50 }), "Ce véhicule ajoute 50 € au tarif calculé.");
    assert.equal(describeSurcharge({ mode: "per_km", value: 0.5 }), "Ce véhicule ajoute 0,5 € pour chaque kilomètre facturable.");
    assert.equal(describeSurcharge({ mode: "percent_km", value: 20 }), "Ce véhicule augmente de 20 % la composante kilométrique du tarif.");
  });
});

describe("supplément véhicule branché sur le moteur existant", () => {
  it("le tarif de base du moteur n'est pas modifié par l'ajout de l'assiette", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    assert.ok(r.tarif > 0);
    assert.ok(r.vehicleBasis);
    assert.equal(r.vehicleBasis!.kmApplicable, true);
  });

  it("aller simple : km facturables = approche + trajet + retour dépôt", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    assert.equal(r.vehicleBasis!.billableKm, 41);
  });

  it("retour dépôt désactivé : il n'est pas compté dans les km facturables", async () => {
    const engine = engineWith({ returnToBaseEnabled: false });
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none }, engine);
    assert.equal(r.vehicleBasis!.billableKm, 35);
  });

  it("aucun supplément : total inchangé", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    const base = r.tarif;
    const snap = applyVehicleToResult(r, vehicle("none", 0));
    assert.equal(r.tarif, base);
    assert.equal(snap.surcharge.amount, 0);
    assert.equal(r.tarifBase, base);
  });

  it("+50 € fixe : total = base + 50", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    const base = r.tarif;
    applyVehicleToResult(r, vehicle("fixed", 50));
    assert.equal(r.tarif, base + 50);
    assert.equal(r.tarifBase, base);
    assert.equal((r.tarifs as Record<string, number>).vehicleSurcharge, 50);
  });

  it("+0,50 €/km : 41 km facturables → +21 € (20,5 arrondi à l'euro supérieur)", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    const base = r.tarif;
    applyVehicleToResult(r, vehicle("per_km", 0.5));
    assert.equal(r.tarif, base + 21);
  });

  it("+20 % de la composante kilométrique : le % porte sur le montant kilométrique, pas sur le total", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(5, 30, 6), retour: none });
    const base = r.tarif;
    const kmAmount = r.vehicleBasis!.kmAmount;
    const snap = applyVehicleToResult(r, vehicle("percent_km", 20));
    assert.equal(snap.surcharge.amount, Math.ceil(Math.round(kmAmount * 0.2 * 100) / 100 - 1e-9));
    assert.equal(r.tarif, base + snap.surcharge.amount);
  });

  it("minimum tarifaire : le minimum s'applique au tarif métier, le supplément s'ajoute après", async () => {
    const r = await run("classique", classique("Aller Simple"), { aller: leg(0, 1, 0), retour: none });
    const base = r.tarif;
    assert.ok(base >= 1);
    const snap = applyVehicleToResult(r, vehicle("fixed", 50));
    assert.equal(r.tarif, base + 50);
    assert.equal(snap.tarifBase, base);
    // per_km sur 1 km facturable : ne dépend pas du minimum
    const r2 = await run("classique", classique("Aller Simple"), { aller: leg(0, 1, 0), retour: none });
    applyVehicleToResult(r2, vehicle("per_km", 0.5));
    assert.equal(r2.tarif, r2.tarifBase! + 1);
  });

  it("aller-retour : toutes les branches comptent dans l'assiette kilométrique", async () => {
    const r = await run("classique", classique("Aller/Retour"), { aller: leg(5, 30, 6), retour: leg(4, 30, 5) });
    assert.equal(r.vehicleBasis!.billableKm, 5 + 30 + 6 + 4 + 30 + 5);
  });

  it("aller-retour avec remise A/R : l'assiette % suit la remise (appliquée une seule fois)", async () => {
    const engine = engineWith({ applyArDiscount: true, arDiscountPercent: 10 });
    const noDiscount = engineWith({ applyArDiscount: false, arDiscountPercent: 0 });
    const d: Distances = { aller: leg(5, 30, 6), retour: leg(4, 30, 5) };
    const a = await run("classique", classique("Aller/Retour"), d, engine);
    const b = await run("classique", classique("Aller/Retour"), d, noDiscount);
    assert.ok(Math.abs(a.vehicleBasis!.kmAmount - b.vehicleBasis!.kmAmount * 0.9) < 1e-6);
    assert.equal(a.vehicleBasis!.billableKm, b.vehicleBasis!.billableKm);
  });

  it("A/R + mise à disposition : l'heure de MAD n'entre pas dans l'assiette kilométrique", async () => {
    const withMad = await run(
      "classique",
      classique("A/R + Mise à disposition", { HeureMADClassique: "3" }),
      { aller: leg(5, 30, 6), retour: leg(4, 30, 5) },
      engineWith({ applyArDiscount: false, arDiscountPercent: 0 })
    );
    const plain = await run(
      "classique",
      classique("Aller/Retour"),
      { aller: leg(5, 30, 6), retour: leg(4, 30, 5) },
      engineWith({ applyArDiscount: false, arDiscountPercent: 0 })
    );
    assert.ok(withMad.tarif > plain.tarif);
    assert.equal(withMad.vehicleBasis!.kmAmount, plain.vehicleBasis!.kmAmount);
  });

  it("hors zone : le coefficient hors zone s'applique aussi à l'assiette kilométrique", async () => {
    const outside = {
      ...classique("Aller Simple"),
      AdresseDepart_1: "10 rue de Rivoli, 13001 Marseille, France",
      AdresseArrivee_1: "12 rue Paradis, 13006 Marseille, France",
    } as Record<string, unknown>;
    (outside.trajetClassique as Record<string, string>).TCallerpriseencharge = "10 rue de Rivoli, 13001 Marseille, France";
    (outside.trajetClassique as Record<string, string>).TCallerDestination = "12 rue Paradis, 13006 Marseille, France";
    const d: Distances = { aller: leg(5, 30, 6), retour: none };
    const x1 = await run("classique", outside, d, engineWith({ outOfPrimaryServiceZoneMultiplier: 1 }));
    const x2 = await run("classique", outside, d, engineWith({ outOfPrimaryServiceZoneMultiplier: 1.5 }));
    assert.ok(Math.abs(x2.vehicleBasis!.kmAmount - x1.vehicleBasis!.kmAmount * 1.5) < 1e-6);
    assert.ok(x2.tarif > x1.tarif);
  });

  it("aéroport : approche, trajet et retour dépôt sont facturés → assiette = tous les km", async () => {
    const payload = {
      general: { TypeService: "Transfert Aéroport" },
      transfertAeroport: {
        TAtrajet: "Aller Simple",
        TAallerpriseencharge: "1 rue test, 76300 Bihorel, France",
        TAallerdestination: "Aéroport Paris-Orly",
        TAallerdate: "10/05/2026",
        TAallerheure: "08:00",
        TApassagers: "2",
      },
      AdresseArrivee_1: "Aéroport Paris-Orly",
    };
    const r = await run("aeroport", payload, { aller: leg(5, 120, 125), retour: none });
    assert.equal(r.vehicleBasis!.billableKm, 250);
    assert.ok(r.vehicleBasis!.kmAmount > 0);
    const base = r.tarif;
    applyVehicleToResult(r, vehicle("fixed", 50));
    assert.equal(r.tarif, base + 50);
  });

  it("mise à disposition événementielle : pas de km → km et % valent 0, le fixe s'applique", async () => {
    const payload = {
      general: { TypeService: "MAD Evenementiel" },
      madEvenementiel: {
        LieuEvenement: "Salle des fêtes, 76000 Rouen, France",
        DateEvenement: "10/05/2026",
        HeureEvenement: "14:00",
        HeureMADEvenement: "4",
      },
    };
    const r = await run("mad-evenementiel", payload, { aller: leg(8, 0, 8), retour: none });
    assert.equal(r.vehicleBasis!.kmApplicable, false);
    const base = r.tarif;
    const perKm = applyVehicleToResult(structuredClone(r), vehicle("per_km", 1));
    assert.equal(perKm.surcharge.amount, 0);
    const pct = applyVehicleToResult(structuredClone(r), vehicle("percent_km", 50));
    assert.equal(pct.surcharge.amount, 0);
    applyVehicleToResult(r, vehicle("fixed", 30));
    assert.equal(r.tarif, base + 30);
  });
});
