/**
 * Passe 3 — fériés 2027/2028 via calcul programmatique (union avec publicHolidays tenant).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { calculerTarif } from "../../modules/pricing";
import type { TenantPricingEngineConfig } from "../../modules/pricing/engineTypes";
import { isFerie } from "../../modules/pricing/creneaux";
import { easterSunday, frenchPublicHolidays } from "../../modules/pricing/frenchHolidays";

const distancesLong = {
  aller: {
    approche: { km: 10, duree: 900 },
    trajet: { km: 200, duree: 7200 },
    retourBase: { km: 10, duree: 900 },
  },
  retour: {
    approche: { km: 10, duree: 900 },
    trajet: { km: 200, duree: 7200 },
    retourBase: { km: 10, duree: 900 },
  },
};

function loadDefaultEngine(): TenantPricingEngineConfig {
  return JSON.parse(
    readFileSync("./src/config/tenants/engines/default.engine.json", "utf8")
  ) as TenantPricingEngineConfig;
}

function easterMonday(year: number): string {
  const e = easterSunday(year);
  return DateTime.fromObject(
    { year: e.year, month: e.month, day: e.day },
    { zone: "Europe/Paris" }
  )
    .plus({ days: 1 })
    .toFormat("dd/MM/yyyy");
}

const HOLIDAYS_2027_2028: Array<{ label: string; date: string }> = [
  { label: "1er janvier 2027", date: "01/01/2027" },
  { label: "lundi de Pâques 2027", date: easterMonday(2027) },
  { label: "1er mai 2027", date: "01/05/2027" },
  { label: "14 juillet 2027", date: "14/07/2027" },
  { label: "25 décembre 2027", date: "25/12/2027" },
  { label: "1er janvier 2028", date: "01/01/2028" },
  { label: "lundi de Pâques 2028", date: easterMonday(2028) },
  { label: "1er mai 2028", date: "01/05/2028" },
  { label: "14 juillet 2028", date: "14/07/2028" },
  { label: "25 décembre 2028", date: "25/12/2028" },
];

function withHoliday(
  engine: TenantPricingEngineConfig,
  date: string
): TenantPricingEngineConfig {
  return {
    ...engine,
    publicHolidays: [...engine.publicHolidays, date],
  };
}

function middayPayloadAS(date: string) {
  return {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "Aller Simple",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "75001 Paris",
      TCallerdate: date,
      TCallerheure: "12:00",
    },
  };
}

function middayPayloadAR(date: string) {
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

function middayPayloadMAD(date: string) {
  return {
    general: { TypeService: "Trajet Classique" },
    trajetClassique: {
      TCtrajet: "A/R + Mise à disposition",
      TCallerpriseencharge: "76000 Rouen",
      TCallerDestination: "75001 Paris",
      TCallerdate: date,
      TCallerheure: "10:00",
      TCretourdate: date,
      TCretourheure: "18:00",
      HeureMADClassique: "3",
    },
  };
}

function middayPayloadEventiel(date: string) {
  return {
    general: { TypeService: "MAD Evenementiel" },
    madEvenementiel: {
      LieuEvenement: "76000 Rouen",
      DateEvenement: date,
      HeureEvenement: "14:00",
      HeureMADEvenement: "5",
    },
  };
}

describe("QA Passe 3 — fériés 2027/2028 calculés", () => {
  it("default.engine.json reste limité à 2025-2026 (liste tenant / legacy)", () => {
    const engine = loadDefaultEngine();
    assert.ok(engine.publicHolidays.every((d) => /\/202[56]$/.test(d)));
    assert.equal(engine.publicHolidays.includes("01/01/2027"), false);
    assert.equal(easterMonday(2027), "29/03/2027");
    assert.equal(easterMonday(2028), "17/04/2028");
    const e27 = easterSunday(2027);
    assert.equal(
      DateTime.fromObject(
        { year: e27.year, month: e27.month, day: e27.day },
        { zone: "Europe/Paris" }
      ).toFormat("dd/MM/yyyy"),
      "28/03/2027"
    );
  });

  it("isFerie est vrai pour tous les fériés FR 2027-2028 (sans les lister)", () => {
    const engine = loadDefaultEngine();
    for (const h of HOLIDAYS_2027_2028) {
      const dt = DateTime.fromFormat(`${h.date} 12:00`, "dd/MM/yyyy HH:mm", {
        zone: engine.timezone,
      });
      assert.equal(isFerie(dt, engine), true, `${h.label} (${h.date})`);
      assert.ok(frenchPublicHolidays(Number(h.date.slice(-4))).includes(h.date));
    }
  });

  for (const scenario of [
    { name: "aller simple", type: "classique" as const, body: middayPayloadAS },
    { name: "aller-retour", type: "classique" as const, body: middayPayloadAR },
    { name: "MAD", type: "classique" as const, body: middayPayloadMAD },
    { name: "événementiel", type: "mad-evenementiel" as const, body: middayPayloadEventiel },
  ]) {
    describe(`scénario ${scenario.name}`, () => {
      for (const h of HOLIDAYS_2027_2028) {
        it(`${h.label} : majoration fériée appliquée (= date forcée dans publicHolidays)`, async () => {
          const engine = loadDefaultEngine();
          const payload = scenario.body(h.date);
          const computed = await calculerTarif(
            scenario.type,
            payload,
            distancesLong,
            engine
          );
          const withListed = await calculerTarif(
            scenario.type,
            payload,
            distancesLong,
            withHoliday(engine, h.date)
          );

          assert.equal(
            computed.tarif,
            withListed.tarif,
            `${h.label}: tarif calculé doit égaler tarif avec date listée`
          );

          // Jour ouvré de référence (même année, hors férié / WE si possible)
          const refDate =
            h.date.startsWith("01/01/")
              ? `05/01/${h.date.slice(-4)}` // lundi/mardi typique
              : h.date.startsWith("25/12/")
                ? `23/12/${h.date.slice(-4)}`
                : `15/06/${h.date.slice(-4)}`;
          const refDt = DateTime.fromFormat(`${refDate} 12:00`, "dd/MM/yyyy HH:mm", {
            zone: engine.timezone,
          });
          const holidayDt = DateTime.fromFormat(`${h.date} 12:00`, "dd/MM/yyyy HH:mm", {
            zone: engine.timezone,
          });
          const alreadyWe = holidayDt.weekday === 6 || holidayDt.weekday === 7;
          if (!alreadyWe && refDt.weekday >= 1 && refDt.weekday <= 5) {
            const ouvrable = await calculerTarif(
              scenario.type,
              scenario.body(refDate),
              distancesLong,
              engine
            );
            if (scenario.name === "événementiel") {
              assert.ok(
                computed.tarif >= ouvrable.tarif,
                `${h.label}: événementiel férié (${computed.tarif}) ≥ ouvrable (${ouvrable.tarif})`
              );
            } else {
              assert.ok(
                computed.tarif > ouvrable.tarif,
                `${h.label}: attendu férié (${computed.tarif}) > ouvrable (${ouvrable.tarif})`
              );
            }
          }
        });
      }
    });
  }

  it("régression 2026 : un férié listé (01/05/2026) applique bien la majoration vs jour ouvré", async () => {
    const engine = loadDefaultEngine();
    assert.ok(engine.publicHolidays.includes("01/05/2026"));
    const ferie = await calculerTarif(
      "classique",
      middayPayloadAS("01/05/2026"),
      distancesLong,
      engine
    );
    const ouvrable = await calculerTarif(
      "classique",
      middayPayloadAS("30/04/2026"),
      distancesLong,
      engine
    );
    assert.ok(
      ferie.tarif > ouvrable.tarif,
      `attendu 01/05/2026 (${ferie.tarif}) > 30/04/2026 (${ouvrable.tarif})`
    );
  });

  it("régression 2025 : 14/07/2025 reste reconnu (liste + calcul)", async () => {
    const engine = loadDefaultEngine();
    const dt = DateTime.fromFormat("14/07/2025 12:00", "dd/MM/yyyy HH:mm", {
      zone: engine.timezone,
    });
    assert.equal(isFerie(dt, { ...engine, publicHolidays: [] }), true);
    assert.equal(isFerie(dt, engine), true);
  });
});
