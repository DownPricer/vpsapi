import { DateTime } from "luxon";
import { getDistancesWithFallback } from "../distance/distanceMatrix";
import { calculerCreneaux, isFerie } from "./creneaux";
import type { TenantPricingEngineConfig } from "./engineTypes";
import { getPrimaryServiceZoneCommunes } from "./zoneSets/registry";
import type { Distances, TarifResult } from "./types";
import {
  airportAddressFrom,
  getFormattedAddress,
  normalizeTCtrajet,
  normalizeTypeService,
} from "./utils";

const AR_MAD_CANON = "A/R + Mise à disposition";

/**
 * Adresse de base / dépôt chauffeur pour cette requête.
 * Le front envoie `vtcBaseAddress` (tenant settings) ; sinon repli sur `engine.depotAddress` (config serveur).
 */
export function resolveVtcBaseAddress(
  payload: Record<string, unknown>,
  engine: TenantPricingEngineConfig
): string {
  const raw = payload.vtcBaseAddress;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.length > 0) return t;
  }
  return engine.depotAddress;
}

function normalizeString(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-,'.]+/g, " ")
    .trim();
}

export function isInPrimaryServiceZone(
  adresseDepart: string,
  engine: TenantPricingEngineConfig
): boolean {
  const set = getPrimaryServiceZoneCommunes(engine.primaryServiceZoneSetId) ?? new Set<string>();
  const adresseNormalisee = normalizeString(adresseDepart);
  for (const commune of Array.from(set)) {
    if (adresseNormalisee.includes(commune)) return true;
  }
  return false;
}

function zoneFromDistance(d: number): number {
  const x = Number(d) || 0;
  if (x <= 15) return 1;
  if (x <= 35) return 2;
  if (x <= 80) return 3;
  if (x <= 120) return 4;
  return 5;
}

function kmTarifClassique(
  distKm: number,
  zone: number,
  isAR: boolean,
  engine: TenantPricingEngineConfig
): number {
  const zones = isAR ? engine.tcTable.AR.ZONES : engine.tcTable.SIMPLE.ZONES;
  const zoneConfig = zones[zone as keyof typeof zones];
  if (!zoneConfig) return 2.0;
  const table = zoneConfig.tarifsKm as Record<string, number>;
  if (distKm <= 50) return table["1-50"] ?? 2.0;
  if (distKm <= 90) return table["51-90"] ?? 1.8;
  if (zone === 5) {
    if (distKm <= 200) return table["91-200"] ?? 1.8;
    return table["+200"] ?? 1.6;
  }
  if (distKm <= 150) return table["91-150"] ?? 1.6;
  return table["+150"] ?? 1.4;
}

function ceil5(x: number): number {
  return Math.ceil((Number(x) || 0) / 5) * 5;
}

function majFrom(
  base: number,
  dt: DateTime | null,
  engine: TenantPricingEngineConfig
): { amount: number; reasons: string[] } {
  if (!dt?.isValid || !base)
    return { amount: 0, reasons: [] };
  let pct = 0;
  const reasons: string[] = [];
  const isFerieDt = isFerie(dt, engine);
  const isWeekend = dt && (dt.weekday === 6 || dt.weekday === 7);
  const isNight = dt && (dt.hour >= 22 || dt.hour < 6);
  const isEvening = dt && dt.hour >= 19 && dt.hour < 22;
  if (isFerieDt) {
    pct += engine.maj.pctFerie;
    reasons.push("jour férié");
  }
  if (isWeekend) {
    pct += engine.maj.pctWE;
    reasons.push("week-end");
  }
  if (isNight) {
    pct += engine.maj.pctNight;
    reasons.push("nuit");
  } else if (isEvening) {
    pct += engine.maj.pctEvening;
    reasons.push("soirée");
  }
  const amount = Math.max(
    engine.maj.minEuros,
    Math.round((base * pct + Number.EPSILON) * 100) / 100
  );
  return { amount, reasons };
}

function readManualMaj(
  payload: Record<string, unknown>,
  key: string
): number | null {
  const v = Number(
    (payload?.general as Record<string, unknown>)?.[key] ?? (payload as Record<string, unknown>)?.[key]
  );
  return Number.isFinite(v) ? v : null;
}

export function buildGcalUrl(
  params: {
    startISO: string;
    endISO: string;
    title?: string;
    details?: string;
    location?: string;
  },
  engine: TenantPricingEngineConfig
): string | null {
  const { startISO, endISO, title, details, location } = params;
  try {
    const dStart = DateTime.fromISO(startISO, { zone: "utc" });
    const dEnd = DateTime.fromISO(endISO, { zone: "utc" });
    if (!dStart.isValid || !dEnd.isValid) return null;
    const s = dStart.toFormat("yyyyMMdd'T'HHmmss'Z'");
    const e = dEnd.toFormat("yyyyMMdd'T'HHmmss'Z'");
    const enc = encodeURIComponent;
    const q = [
      `action=TEMPLATE`,
      `text=${enc(title || engine.calendarEventTitlePrefix)}`,
      `dates=${s}/${e}`,
      `details=${enc(details || "")}`,
      `location=${enc(location || "")}`,
      `sf=true`,
      `output=xml`,
    ].join("&");
    return `https://calendar.google.com/calendar/render?${q}`;
  } catch {
    return null;
  }
}

export async function calculerDistances(
  apiKey: string,
  payload: Record<string, unknown>,
  engine: TenantPricingEngineConfig
): Promise<Distances> {
  const tsNorm = normalizeTypeService((payload?.general as Record<string, unknown>)?.TypeService as string);
  const dist: Distances = {
    aller: {
      approche: { km: 0, duree: 0 },
      trajet: { km: 0, duree: 0 },
      retourBase: { km: 0, duree: 0 },
    },
    retour: {
      approche: { km: 0, duree: 0 },
      trajet: { km: 0, duree: 0 },
      retourBase: { km: 0, duree: 0 },
    },
  };

  const base = resolveVtcBaseAddress(payload, engine);
  const addresses = new Set<string>();
  const add = (a: string | { formatted?: string } | null | undefined) => {
    const f = getFormattedAddress(a);
    if (f && f !== "N/A" && f !== "Non concerné") addresses.add(f);
  };

  if (tsNorm === "MAD Evenementiel") {
    add(base);
    add((payload?.madEvenementiel as Record<string, string>)?.LieuEvenement);
  } else if (tsNorm === "Trajet Classique") {
    const t = (payload?.trajetClassique || {}) as Record<string, string>;
    const tct = normalizeTCtrajet(t?.TCtrajet);
    add(base);
    add(t?.TCallerpriseencharge);
    add(t?.TCallerDestination);
    if (tct === "Aller/Retour" || tct === AR_MAD_CANON) {
      add(t?.TCretourpriseencharge);
      add(t?.TCretourDestination);
    }
  } else if (tsNorm === "Transfert Aéroport") {
    const a = (payload?.transfertAeroport || {}) as Record<string, string>;
    add(base);
    add(airportAddressFrom(a?.TAallerpriseencharge, engine));
    add(airportAddressFrom(a?.TAallerdestination, engine));
    if (a?.TAtrajet === "Aller/Retour") {
      add(airportAddressFrom(a?.TAretourpriseencharge, engine));
      add(airportAddressFrom(a?.TAretourdestination, engine));
    }
  }

  const list = Array.from(addresses);
  if (list.length === 0) return dist;

  const dm = await getDistancesWithFallback(apiKey, list, list);
  const get = (o: string, d: string) =>
    dm[`${getFormattedAddress(o)}->${getFormattedAddress(d)}`] || {
      km: 0,
      duree: 0,
    };

  if (tsNorm === "MAD Evenementiel") {
    const L = (payload?.madEvenementiel as Record<string, string>)
      ?.LieuEvenement;
    dist.aller.approche = get(base, L);
    dist.aller.retourBase = get(L, base);
  } else if (tsNorm === "Trajet Classique") {
    const t = (payload?.trajetClassique || {}) as Record<string, string>;
    const tct = normalizeTCtrajet(t?.TCtrajet);
    dist.aller.approche = get(base, t?.TCallerpriseencharge);
    dist.aller.trajet = get(t?.TCallerpriseencharge, t?.TCallerDestination);
    dist.aller.retourBase = get(t?.TCallerDestination, base);
    if (tct === "Aller/Retour" || tct === AR_MAD_CANON) {
      dist.retour.approche = get(base, t?.TCretourpriseencharge);
      dist.retour.trajet = get(t?.TCretourpriseencharge, t?.TCretourDestination);
      dist.retour.retourBase = get(t?.TCretourDestination, base);
    }
  } else if (tsNorm === "Transfert Aéroport") {
    const a = (payload?.transfertAeroport || {}) as Record<string, string>;
    const p1 = airportAddressFrom(a?.TAallerpriseencharge, engine);
    const d1 = airportAddressFrom(a?.TAallerdestination, engine);
    dist.aller.approche = get(base, p1);
    dist.aller.trajet = get(p1, d1);
    dist.aller.retourBase = get(d1, base);
    if (a?.TAtrajet === "Aller/Retour") {
      const p2 = airportAddressFrom(a?.TAretourpriseencharge, engine);
      const d2 = airportAddressFrom(a?.TAretourdestination, engine);
      dist.retour.approche = get(base, p2);
      dist.retour.trajet = get(p2, d2);
      dist.retour.retourBase = get(d2, base);
    }
  }
  return dist;
}

export async function calculerTarif(
  type: "mad-evenementiel" | "classique" | "aeroport",
  payload: Record<string, unknown>,
  distances: Distances,
  engine: TenantPricingEngineConfig
): Promise<TarifResult> {
  const fmt = (x: number | undefined) => Number(x) || 0;
  const TZ = { zone: engine.timezone };

  const tarifs: Record<string, number | Record<string, number>> = {
    aller: {},
    retour: {},
    miseADisposition: 0,
    total: 0,
    majAller: 0,
    majRetour: 0,
  };
  const majorations: Array<{ leg: string; montant: number }> = [];

  const parseDT = (d: string, h: string) =>
    d && h
      ? DateTime.fromFormat(`${d} ${h}`, "dd/MM/yyyy HH:mm", TZ)
      : null;

  if (type === "mad-evenementiel") {
    const e = (payload?.madEvenementiel || {}) as Record<string, string>;
    const startEvt = parseDT(e.DateEvenement, e.HeureEvenement);
    const heures = parseFloat(e.HeureMADEvenement) || 0;

    let tarifHoraire: number = engine.madHourlyRates.default;
    if (startEvt?.isValid) {
      const soiree = startEvt.hour >= 19 && startEvt.hour < 22;
      const nuit = startEvt.hour >= 22 || startEvt.hour < 6;
      if (
        startEvt.weekday === 6 ||
        startEvt.weekday === 7 ||
        isFerie(startEvt, engine)
      )
        tarifHoraire = engine.madHourlyRates.weekendOrHoliday;
      else if (nuit || soiree) tarifHoraire = engine.madHourlyRates.eveningOrNight;
    }
    (tarifs.aller as Record<string, number>).approche = 0;
    (tarifs.aller as Record<string, number>).retourBase = 0;
    (tarifs.aller as Record<string, number>).total = 0;
    tarifs.miseADisposition = heures * tarifHoraire;
    tarifs.majAller = 0;
    tarifs.majRetour = 0;
    let total = fmt(tarifs.miseADisposition as number);
    total = Math.max(total, engine.madEventMinimumTotal);
    tarifs.total = total;

    const creneaux = await calculerCreneaux(payload, distances, engine);
    return {
      tarif: Math.ceil(total),
      distances,
      tarifs,
      majorations,
      ...creneaux,
    } as TarifResult;
  }

  if (type === "classique") {
    const t = (payload?.trajetClassique || {}) as Record<string, string>;
    const tct = normalizeTCtrajet(t?.TCtrajet);
    const isAR = tct === "Aller/Retour" || tct === AR_MAD_CANON;

    const dBaseDepart = Math.min(
      distances.aller.approche.km ?? 0,
      distances.aller.retourBase.km ?? 0
    );
    const dBaseArrivee = Math.min(
      (distances.aller.trajet.km ?? 0) + (distances.aller.retourBase.km ?? 0),
      (distances.aller.approche.km ?? 0) + (distances.aller.trajet.km ?? 0)
    );
    const dPrincipal = Math.min(dBaseDepart, dBaseArrivee);
    const zone = zoneFromDistance(dPrincipal);
    const tKmAller = kmTarifClassique(distances.aller.trajet.km ?? 0, zone, isAR, engine);
    const apCoef = isAR ? engine.tcTable.AR.APPROCHE : engine.tcTable.SIMPLE.APPROCHE;

    const approcheKm = distances.aller.approche.km ?? 0;
    const retourBaseKm = distances.aller.retourBase.km ?? 0;
    const distanceMin = Math.min(approcheKm, retourBaseKm);

    (tarifs.aller as Record<string, number>).approche =
      approcheKm === distanceMin ? approcheKm * apCoef : 0;
    const trajetKm = distances.aller.trajet.km ?? 0;
    const supplementTrajet = trajetKm >= 1 && trajetKm <= 50 ? 0.2 : 0.1;
    (tarifs.aller as Record<string, number>).trajet =
      trajetKm * (tKmAller + supplementTrajet);
    (tarifs.aller as Record<string, number>).retourBase =
      retourBaseKm === distanceMin ? retourBaseKm * apCoef : 0;
    (tarifs.aller as Record<string, number>).total =
      fmt((tarifs.aller as Record<string, number>).approche) +
      fmt((tarifs.aller as Record<string, number>).trajet) +
      fmt((tarifs.aller as Record<string, number>).retourBase);

    let total = (tarifs.aller as Record<string, number>).total;

    if (isAR) {
      const tKmRetour = kmTarifClassique(
        distances.retour.trajet.km ?? 0,
        zone,
        true,
        engine
      );
      const approcheRetourKm = distances.retour.approche.km ?? 0;
      const retourBaseRetourKm = distances.retour.retourBase.km ?? 0;
      const distanceMinRetour = Math.min(approcheRetourKm, retourBaseRetourKm);

      (tarifs.retour as Record<string, number>).approche =
        approcheRetourKm === distanceMinRetour
          ? approcheRetourKm * engine.tcTable.AR.APPROCHE
          : 0;
      const trajetRetourKm = distances.retour.trajet.km ?? 0;
      const supplementRetour = trajetRetourKm >= 1 && trajetRetourKm <= 50 ? 0.2 : 0.1;
      (tarifs.retour as Record<string, number>).trajet =
        trajetRetourKm * (tKmRetour + supplementRetour);
      (tarifs.retour as Record<string, number>).retourBase =
        retourBaseRetourKm === distanceMinRetour
          ? retourBaseRetourKm * engine.tcTable.AR.APPROCHE
          : 0;
      (tarifs.retour as Record<string, number>).total =
        fmt((tarifs.retour as Record<string, number>).approche) +
        fmt((tarifs.retour as Record<string, number>).trajet) +
        fmt((tarifs.retour as Record<string, number>).retourBase);
      total += (tarifs.retour as Record<string, number>).total;

      if (tct === AR_MAD_CANON) {
        const approcheAllerKm = distances.aller.approche.km ?? 0;
        const retourBaseRetourKmMAD = distances.retour.retourBase.km ?? 0;
        const distanceMinAR = Math.min(approcheAllerKm, retourBaseRetourKmMAD);

        (tarifs.aller as Record<string, number>).approche =
          approcheAllerKm === distanceMinAR ? approcheAllerKm * apCoef : 0;
        (tarifs.aller as Record<string, number>).total =
          fmt((tarifs.aller as Record<string, number>).approche) +
          fmt((tarifs.aller as Record<string, number>).trajet);
        (tarifs.retour as Record<string, number>).retourBase =
          retourBaseRetourKmMAD === distanceMinAR
            ? retourBaseRetourKmMAD * engine.tcTable.AR.APPROCHE
            : 0;
        (tarifs.retour as Record<string, number>).total =
          fmt((tarifs.retour as Record<string, number>).trajet) +
          fmt((tarifs.retour as Record<string, number>).retourBase);
        total =
          (tarifs.aller as Record<string, number>).total +
          (tarifs.retour as Record<string, number>).total;

        const dtAllerMAD = parseDT(t?.TCallerdate, t?.TCallerheure);
        let tarifHoraireMAD: number = engine.madHourlyRates.default;
        if (dtAllerMAD?.isValid) {
          const soiree =
            dtAllerMAD.hour >= 19 && dtAllerMAD.hour < 22;
          const nuit = dtAllerMAD.hour >= 22 || dtAllerMAD.hour < 6;
          if (
            dtAllerMAD.weekday === 6 ||
            dtAllerMAD.weekday === 7 ||
            isFerie(dtAllerMAD, engine)
          )
            tarifHoraireMAD = engine.madHourlyRates.weekendOrHoliday;
          else if (nuit || soiree) tarifHoraireMAD = engine.madHourlyRates.eveningOrNight;
        }
        tarifs.miseADisposition =
          tarifHoraireMAD * (parseFloat(t.HeureMADClassique) || 0);
        total += tarifs.miseADisposition as number;
      }
      if (engine.applyArDiscount) total = total * 0.95;
    }

    const dtAller = parseDT(t?.TCallerdate, t?.TCallerheure);
    let dtRetour = parseDT(t?.TCretourdate, t?.TCretourheure);

    if (!dtRetour && tct === AR_MAD_CANON) {
      const dTraAmin = Math.round((distances?.aller?.trajet?.duree || 0) / 60);
      const hMAD = Number(t?.HeureMADClassique) || 0;
      if (dtAller?.isValid)
        dtRetour = dtAller.plus({ minutes: dTraAmin }).plus({ hours: hMAD });
    }

    const baseAllerForMaj = fmt((tarifs.aller as Record<string, number>).total);
    const baseRetourForMaj = isAR
      ? fmt((tarifs.retour as Record<string, number>).total)
      : 0;
    const mA =
      readManualMaj(payload, "majoration_aller") ??
      majFrom(baseAllerForMaj, dtAller, engine).amount;
    const mR = isAR
      ? readManualMaj(payload, "majoration_retour") ??
        majFrom(baseRetourForMaj, dtRetour, engine).amount
      : 0;
    tarifs.majAller = fmt(mA);
    tarifs.majRetour = fmt(mR);
    total += (tarifs.majAller as number) + (tarifs.majRetour as number);

    const adresseDepart = getFormattedAddress(
      t?.TCallerpriseencharge || (payload?.AdresseDepart_1 as string) || ""
    );
    if (!isInPrimaryServiceZone(adresseDepart, engine)) total *= engine.outOfPrimaryServiceZoneMultiplier;

    const zones = isAR ? engine.tcTable.AR.ZONES : engine.tcTable.SIMPLE.ZONES;
    const zoneConfig = zones[zone as keyof typeof zones];
    const minZone = zoneConfig?.min ?? 0;
    tarifs.total = Math.max(total, minZone);

    majorations.push({ leg: "aller", montant: tarifs.majAller as number });
    if (isAR)
      majorations.push({ leg: "retour", montant: tarifs.majRetour as number });

    const creneaux = await calculerCreneaux(payload, distances, engine);
    return {
      tarif: Math.ceil(tarifs.total as number),
      distances,
      tarifs,
      majorations,
      ...creneaux,
    } as TarifResult;
  }

  if (type === "aeroport") {
    const a = (payload?.transfertAeroport || {}) as Record<string, string>;
    const destStr = String(
      (payload?.AdresseArrivee_1 as string) || a?.TAallerdestination || ""
    );
    let airportCode = "ORY";
    for (const [code, ap] of Object.entries(engine.airports)) {
      if (ap.names.some((n) => destStr.toLowerCase().includes(n))) {
        airportCode = code;
        break;
      }
    }
    const pax = Math.max(1, Math.min(4, parseInt(a?.TApassagers) || 1));
    const plage = pax <= 2 ? "1-2" : "3-4";
    const isAR = a?.TAtrajet === "Aller/Retour";
    const cfgType = isAR ? "ALLER_RETOUR" : "SIMPLE";
    const taForAirport = engine.taTable[airportCode] ?? engine.taTable.ORY;
    const cfg =
      taForAirport?.[cfgType]?.[plage] ??
      engine.taTable.ORY[cfgType][plage];
    const k = cfg.tarifKm;

    (tarifs.aller as Record<string, number>).approche =
      (distances.aller.approche.km || 0) * k;
    (tarifs.aller as Record<string, number>).trajet =
      (distances.aller.trajet.km || 0) * k;
    (tarifs.aller as Record<string, number>).retourBase =
      (distances.aller.retourBase.km || 0) * k;
    (tarifs.aller as Record<string, number>).total =
      (tarifs.aller as Record<string, number>).approche +
      (tarifs.aller as Record<string, number>).trajet +
      (tarifs.aller as Record<string, number>).retourBase;

    let total = (tarifs.aller as Record<string, number>).total;

    if (isAR) {
      (tarifs.retour as Record<string, number>).approche =
        (distances.retour.approche.km || 0) * k;
      (tarifs.retour as Record<string, number>).trajet =
        (distances.retour.trajet.km || 0) * k;
      (tarifs.retour as Record<string, number>).retourBase =
        (distances.retour.retourBase.km || 0) * k;
      (tarifs.retour as Record<string, number>).total =
        (tarifs.retour as Record<string, number>).approche +
        (tarifs.retour as Record<string, number>).trajet +
        (tarifs.retour as Record<string, number>).retourBase;
      total += (tarifs.retour as Record<string, number>).total;
    }

    const mA = readManualMaj(payload, "majoration_aller") ?? 0;
    const mR =
      a?.TAtrajet === "Aller/Retour"
        ? (readManualMaj(payload, "majoration_retour") ?? 0)
        : 0;
    tarifs.majAller = fmt(mA);
    tarifs.majRetour = fmt(mR);
    total += (tarifs.majAller as number) + (tarifs.majRetour as number);

    tarifs.total = Math.max(total, cfg.min);
    majorations.push({ leg: "aller", montant: tarifs.majAller as number });
    if (a?.TAtrajet === "Aller/Retour")
      majorations.push({ leg: "retour", montant: tarifs.majRetour as number });

    const creneaux = await calculerCreneaux(payload, distances, engine);
    const arrondi = ceil5(tarifs.total as number);
    return {
      tarif: arrondi,
      distances,
      tarifs: { ...tarifs, total: arrondi },
      majorations,
      ...creneaux,
    } as TarifResult;
  }

  const creneaux = await calculerCreneaux(payload, distances, engine);
  return {
    tarif: 0,
    distances,
    tarifs,
    majorations,
    ...creneaux,
  } as TarifResult;
}
