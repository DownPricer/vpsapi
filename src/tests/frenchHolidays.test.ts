/**
 * Table de référence des 11 fériés français 2025–2035 + non-régression 2025-2026.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  easterSunday,
  frenchPublicHolidays,
  isFrenchPublicHoliday,
} from "../modules/pricing/frenchHolidays";
import { isFerie } from "../modules/pricing/creneaux";
import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";

function fmt(y: number, m: number, d: number): string {
  return DateTime.fromObject({ year: y, month: m, day: d }, { zone: "Europe/Paris" }).toFormat(
    "dd/MM/yyyy"
  );
}

/** Référence officielle (dimanche de Pâques) — Meeus/Jones/Butcher. */
const EASTER_SUNDAY: Record<number, string> = {
  2025: "20/04/2025",
  2026: "05/04/2026",
  2027: "28/03/2027",
  2028: "16/04/2028",
  2029: "01/04/2029",
  2030: "21/04/2030",
  2031: "13/04/2031",
  2032: "28/03/2032",
  2033: "17/04/2033",
  2034: "09/04/2034",
  2035: "25/03/2035",
};

/** Listes figées historiques (moteur default) — non-régression. */
const ENGINE_2025_2026 = [
  "01/01/2025",
  "14/04/2025",
  "01/05/2025",
  "08/05/2025",
  "22/05/2025",
  "02/06/2025",
  "14/07/2025",
  "15/08/2025",
  "01/11/2025",
  "11/11/2025",
  "25/12/2025",
  "01/01/2026",
  "06/04/2026",
  "01/05/2026",
  "08/05/2026",
  "14/05/2026",
  "25/05/2026",
  "14/07/2026",
  "15/08/2026",
  "01/11/2026",
  "11/11/2026",
  "25/12/2026",
];

describe("frenchHolidays — Pâques Meeus", () => {
  for (const [yearStr, expected] of Object.entries(EASTER_SUNDAY)) {
    const year = Number(yearStr);
    it(`Pâques ${year} = ${expected}`, () => {
      const e = easterSunday(year);
      assert.equal(fmt(e.year, e.month, e.day), expected);
    });
  }
});

describe("frenchHolidays — 11 jours par année 2025-2035", () => {
  for (let year = 2025; year <= 2035; year++) {
    it(`${year} : exactement 11 fériés, Pâques lundi = dimanche+1`, () => {
      const list = frenchPublicHolidays(year);
      assert.equal(list.length, 11);
      assert.equal(list[0], `01/01/${year}`);
      assert.equal(list[10], `25/12/${year}`);
      const e = easterSunday(year);
      const monday = DateTime.fromObject(
        { year: e.year, month: e.month, day: e.day },
        { zone: "Europe/Paris" }
      )
        .plus({ days: 1 })
        .toFormat("dd/MM/yyyy");
      assert.equal(list[1], monday);
      assert.ok(list.includes(`01/05/${year}`));
      assert.ok(list.includes(`08/05/${year}`));
      assert.ok(list.includes(`14/07/${year}`));
      assert.ok(list.includes(`15/08/${year}`));
      assert.ok(list.includes(`01/11/${year}`));
      assert.ok(list.includes(`11/11/${year}`));
    });
  }
});

describe("frenchHolidays — non-régression 2025-2026", () => {
  it("les dates fixes historiques restent fériées (calcul)", () => {
    for (const d of [
      "01/01/2025",
      "01/05/2025",
      "08/05/2025",
      "14/07/2025",
      "15/08/2025",
      "01/11/2025",
      "11/11/2025",
      "25/12/2025",
      "01/01/2026",
      "01/05/2026",
      "08/05/2026",
      "14/07/2026",
      "15/08/2026",
      "01/11/2026",
      "11/11/2026",
      "25/12/2026",
    ]) {
      assert.equal(isFrenchPublicHoliday(d), true, d);
    }
  });

  it("isFerie conserve toutes les dates du moteur default (union liste tenant)", () => {
    const engine = {
      timezone: "Europe/Paris",
      publicHolidays: ENGINE_2025_2026,
    } as unknown as TenantPricingEngineConfig;
    for (const d of ENGINE_2025_2026) {
      const dt = DateTime.fromFormat(`${d} 12:00`, "dd/MM/yyyy HH:mm", {
        zone: "Europe/Paris",
      });
      assert.equal(isFerie(dt, engine), true, d);
    }
  });

  it("Pâques / Ascension / Pentecôte 2025-2026 = dates Meeus officielles", () => {
    assert.deepEqual(frenchPublicHolidays(2025).slice(1, 6), [
      "21/04/2025",
      "01/05/2025",
      "08/05/2025",
      "29/05/2025",
      "09/06/2025",
    ]);
    assert.deepEqual(frenchPublicHolidays(2026).slice(1, 6), [
      "06/04/2026",
      "01/05/2026",
      "08/05/2026",
      "14/05/2026",
      "25/05/2026",
    ]);
  });
});

describe("isFerie — union calcul + liste tenant", () => {
  const engine = {
    timezone: "Europe/Paris",
    publicHolidays: ["02/01/2027"], // exception tenant
  } as unknown as TenantPricingEngineConfig;

  it("reconnaît un férié légal 2027 sans l’avoir listé", () => {
    const dt = DateTime.fromFormat("01/05/2027 12:00", "dd/MM/yyyy HH:mm", {
      zone: "Europe/Paris",
    });
    assert.equal(isFerie(dt, engine), true);
  });

  it("reconnaît une date exceptionnelle du tenant", () => {
    const dt = DateTime.fromFormat("02/01/2027 12:00", "dd/MM/yyyy HH:mm", {
      zone: "Europe/Paris",
    });
    assert.equal(isFerie(dt, engine), true);
    assert.equal(isFrenchPublicHoliday("02/01/2027"), false);
  });

  it("reste faux pour un jour ouvré non listé", () => {
    const dt = DateTime.fromFormat("03/01/2027 12:00", "dd/MM/yyyy HH:mm", {
      zone: "Europe/Paris",
    });
    assert.equal(isFerie(dt, engine), false);
  });
});
