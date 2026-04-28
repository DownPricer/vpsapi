import { DateTime } from "luxon";
import type { TenantPricingEngineConfig } from "./engineTypes";
import { airportCodeFromAddress, normalizeTCtrajet, normalizeTypeService } from "./utils";
import type { CreneauResult, Distances } from "./types";

const AR_MAD_CANON = "A/R + Mise à disposition";

export function isFerie(dt: DateTime, engine: TenantPricingEngineConfig): boolean {
  return engine.publicHolidays.includes(dt.toFormat("dd/MM/yyyy"));
}

export function getAirportBuffers(code: string, engine: TenantPricingEngineConfig) {
  const cfg = engine.airportBuffers[code] || engine.airportBuffers.default;
  return {
    preFlightMin: cfg.preFlightMin,
    arrivalMin: cfg.arrivalMin,
    dropoffMarginMin: cfg.dropoffMarginMin,
  };
}

export async function calculerCreneaux(
  payload: Record<string, unknown>,
  distances: Distances,
  engine: TenantPricingEngineConfig
): Promise<CreneauResult> {
  const ts = normalizeTypeService((payload?.general as Record<string, unknown>)?.TypeService as string);
  const TZ = { zone: engine.timezone };
  const sec = (v: number | undefined) => Number(v) || 0;

  const res: CreneauResult = {
    creneauGlobal: {
      DateDebut: "N/A",
      HeureDebut: "N/A",
      DateFin: "N/A",
      HeureFin: "N/A",
      startISO: "N/A",
      endISO: "N/A",
    },
    creneauxDouble: {
      aller: {
        DateDebut: "N/A",
        HeureDebut: "N/A",
        DateFin: "N/A",
        HeureFin: "N/A",
        startISO: "N/A",
        endISO: "N/A",
      },
      retour: {
        DateDebut: "N/A",
        HeureDebut: "N/A",
        DateFin: "N/A",
        HeureFin: "N/A",
        startISO: "N/A",
        endISO: "N/A",
      },
    },
    googleCreneaux: [],
    classicPickupRetour: null,
    pickupAller: null,
    pickupRetour: null,
  };

  try {
    if (ts === "Trajet Classique") {
      const t = (payload?.trajetClassique || {}) as Record<string, string>;
      const tct = normalizeTCtrajet(t?.TCtrajet);

      const hasAller = Boolean(t?.TCallerdate && t?.TCallerheure);
      const dtAller = hasAller
        ? DateTime.fromFormat(
            `${t.TCallerdate} ${t.TCallerheure}`,
            "dd/MM/yyyy HH:mm",
            TZ
          )
        : null;
      const dAppA = sec(distances?.aller?.approche?.duree);
      const dTraA = sec(distances?.aller?.trajet?.duree);
      const dRBA = sec(distances?.aller?.retourBase?.duree);

      const hasRetour = Boolean(t?.TCretourdate && t?.TCretourheure);
      const dtRetour = hasRetour
        ? DateTime.fromFormat(
            `${t.TCretourdate} ${t.TCretourheure}`,
            "dd/MM/yyyy HH:mm",
            TZ
          )
        : null;
      const dAppR = sec(distances?.retour?.approche?.duree);
      const dTraR = sec(distances?.retour?.trajet?.duree);
      const dRBR = sec(distances?.retour?.retourBase?.duree);

      if (tct === "Aller Simple") {
        if (dtAller?.isValid && dAppA >= 0 && dTraA + dRBA >= 0) {
          const start = dtAller.minus({ seconds: dAppA });
          const end = dtAller.plus({ seconds: dTraA + dRBA });
          res.creneauGlobal.DateDebut = start.toFormat("dd/MM/yyyy");
          res.creneauGlobal.HeureDebut = start.toFormat("HH:mm");
          res.creneauGlobal.DateFin = end.toFormat("dd/MM/yyyy");
          res.creneauGlobal.HeureFin = end.toFormat("HH:mm");
          res.creneauGlobal.startISO = start.toISO() ?? "N/A";
          res.creneauGlobal.endISO = end.toISO() ?? "N/A";
          res.googleCreneaux = [
            { start: res.creneauGlobal.startISO, end: res.creneauGlobal.endISO },
          ];
        }
        return res;
      }

      if (tct === "Aller/Retour") {
        if (dtAller?.isValid) {
          const startA = dAppA > 0 ? dtAller.minus({ seconds: dAppA }) : dtAller;
          const endA = dtAller.plus({ seconds: dTraA + dRBA });
          res.creneauxDouble.aller = {
            DateDebut: startA.toFormat("dd/MM/yyyy"),
            HeureDebut: startA.toFormat("HH:mm"),
            DateFin: endA.toFormat("dd/MM/yyyy"),
            HeureFin: endA.toFormat("HH:mm"),
            startISO: startA.toISO() ?? "N/A",
            endISO: endA.toISO() ?? "N/A",
          };
        }
        if (dtRetour?.isValid) {
          const startR = dAppR > 0 ? dtRetour.minus({ seconds: dAppR }) : dtRetour;
          const endR = dtRetour.plus({ seconds: dTraR + dRBR });
          res.creneauxDouble.retour = {
            DateDebut: startR.toFormat("dd/MM/yyyy"),
            HeureDebut: startR.toFormat("HH:mm"),
            DateFin: endR.toFormat("dd/MM/yyyy"),
            HeureFin: endR.toFormat("HH:mm"),
            startISO: startR.toISO() ?? "N/A",
            endISO: endR.toISO() ?? "N/A",
          };
        }
        res.googleCreneaux = [
          ...(res.creneauxDouble.aller.startISO !== "N/A"
            ? [
                {
                  start: res.creneauxDouble.aller.startISO,
                  end: res.creneauxDouble.aller.endISO,
                },
              ]
            : []),
          ...(res.creneauxDouble.retour.startISO !== "N/A"
            ? [
                {
                  start: res.creneauxDouble.retour.startISO,
                  end: res.creneauxDouble.retour.endISO,
                },
              ]
            : []),
        ];
        return res;
      }

      if (tct === AR_MAD_CANON) {
        const hMAD = Number(t?.HeureMADClassique) || 0;

        if (dtAller?.isValid && dAppA >= 0) {
          const start = dtAller.minus({ seconds: dAppA });
          res.creneauGlobal.DateDebut = start.toFormat("dd/MM/yyyy");
          res.creneauGlobal.HeureDebut = start.toFormat("HH:mm");
          res.creneauGlobal.startISO = start.toISO() ?? "N/A";
        }

        if (dtRetour?.isValid && dTraR + dRBR >= 0) {
          const end = dtRetour.plus({ seconds: dTraR + dRBR });
          res.creneauGlobal.DateFin = end.toFormat("dd/MM/yyyy");
          res.creneauGlobal.HeureFin = end.toFormat("HH:mm");
          res.creneauGlobal.endISO = end.toISO() ?? "N/A";
        } else if (dtAller?.isValid && dTraA + dTraR + dRBR >= 0 && hMAD >= 0) {
          const pickupRetourDeduit = dtAller
            .plus({ seconds: dTraA })
            .plus({ hours: hMAD });
          res.classicPickupRetour = pickupRetourDeduit;
          const end = pickupRetourDeduit.plus({ seconds: dTraR + dRBR });
          res.creneauGlobal.DateFin = end.toFormat("dd/MM/yyyy");
          res.creneauGlobal.HeureFin = end.toFormat("HH:mm");
          res.creneauGlobal.endISO = end.toISO() ?? "N/A";
        }

        if (
          res.creneauGlobal.startISO !== "N/A" &&
          res.creneauGlobal.endISO !== "N/A"
        ) {
          res.googleCreneaux = [
            {
              start: res.creneauGlobal.startISO,
              end: res.creneauGlobal.endISO,
            },
          ];
        }
        return res;
      }
      return res;
    }

    if (ts === "MAD Evenementiel") {
      const e = (payload?.madEvenementiel || {}) as Record<string, string>;
      if (e.DateEvenement && e.HeureEvenement) {
        const startEvt = DateTime.fromFormat(
          `${e.DateEvenement} ${e.HeureEvenement}`,
          "dd/MM/yyyy HH:mm",
          { zone: engine.timezone }
        );
        const hMAD = Number(e.HeureMADEvenement) || 0;
        if (startEvt.isValid) {
          const dApp = sec(distances?.aller?.approche?.duree);
          const dRB = sec(distances?.aller?.retourBase?.duree);
          const start = dApp > 0 ? startEvt.minus({ seconds: dApp }) : startEvt;
          const end = startEvt
            .plus({ hours: hMAD })
            .plus({ seconds: dRB });
          res.creneauGlobal = {
            DateDebut: start.toFormat("dd/MM/yyyy"),
            HeureDebut: start.toFormat("HH:mm"),
            DateFin: end.toFormat("dd/MM/yyyy"),
            HeureFin: end.toFormat("HH:mm"),
            startISO: start.toISO() ?? "N/A",
            endISO: end.toISO() ?? "N/A",
          };
          res.googleCreneaux = [
            {
              start: res.creneauGlobal.startISO,
              end: res.creneauGlobal.endISO,
            },
          ];
        }
      }
      return res;
    }

    if (ts === "Transfert Aéroport") {
      const a = (payload?.transfertAeroport || {}) as Record<string, string>;
      if (a?.TAallerdate && a?.TAallerhoraire) {
        const volAller = DateTime.fromFormat(
          `${a.TAallerdate} ${a.TAallerhoraire}`,
          "dd/MM/yyyy HH:mm",
          { zone: engine.timezone }
        );
        if (volAller.isValid) {
          const code =
            airportCodeFromAddress(
              (payload?.AdresseArrivee_1 as string) || a?.TAallerdestination,
              engine
            ) || "default";
          const { preFlightMin, dropoffMarginMin } = getAirportBuffers(code, engine);
          const trajA = Math.round(
            (distances?.aller?.trajet?.duree || 0) / 60
          );
          const pickupAller = volAller.minus({
            minutes: preFlightMin + dropoffMarginMin + trajA,
          });
          res.pickupAller = pickupAller;
          const dAppA = Math.round(
            (distances?.aller?.approche?.duree || 0) / 60
          );
          const dRBA = Math.round(
            (distances?.aller?.retourBase?.duree || 0) / 60
          );
          const start =
            dAppA > 0 ? pickupAller.minus({ minutes: dAppA }) : pickupAller;
          const end = pickupAller.plus({ minutes: trajA + dRBA });

          if (a?.TAtrajet === "Aller/Retour") {
            res.creneauxDouble.aller = {
              DateDebut: start.toFormat("dd/MM/yyyy"),
              HeureDebut: start.toFormat("HH:mm"),
              DateFin: end.toFormat("dd/MM/yyyy"),
              HeureFin: end.toFormat("HH:mm"),
              startISO: start.toISO() ?? "N/A",
              endISO: end.toISO() ?? "N/A",
            };
          } else {
            res.creneauGlobal = {
              DateDebut: start.toFormat("dd/MM/yyyy"),
              HeureDebut: start.toFormat("HH:mm"),
              DateFin: end.toFormat("dd/MM/yyyy"),
              HeureFin: end.toFormat("HH:mm"),
              startISO: start.toISO() ?? "N/A",
              endISO: end.toISO() ?? "N/A",
            };
            res.googleCreneaux = [
              {
                start: res.creneauGlobal.startISO,
                end: res.creneauGlobal.endISO,
              },
            ];
          }
        }
      }
      if (
        a?.TAtrajet === "Aller/Retour" &&
        a?.TAretourdate &&
        a?.TAretourhoraire
      ) {
        const volR = DateTime.fromFormat(
          `${a.TAretourdate} ${a.TAretourhoraire}`,
          "dd/MM/yyyy HH:mm",
          { zone: engine.timezone }
        );
        if (volR.isValid) {
          const code =
            airportCodeFromAddress(
              (payload?.AdresseDepart_2 as string) || a?.TAretourdestination,
              engine
            ) || "default";
          const { arrivalMin } = getAirportBuffers(code, engine);
          const pickupRetour = volR.plus({ minutes: arrivalMin });
          res.pickupRetour = pickupRetour;
          const dAppR = Math.round(
            (distances?.retour?.approche?.duree || 0) / 60
          );
          const dTraR = Math.round(
            (distances?.retour?.trajet?.duree || 0) / 60
          );
          const dRBR = Math.round(
            (distances?.retour?.retourBase?.duree || 0) / 60
          );
          const start =
            dAppR > 0 ? pickupRetour.minus({ minutes: dAppR }) : pickupRetour;
          const end = pickupRetour.plus({ minutes: dTraR + dRBR });

          res.creneauxDouble.retour = {
            DateDebut: start.toFormat("dd/MM/yyyy"),
            HeureDebut: start.toFormat("HH:mm"),
            DateFin: end.toFormat("dd/MM/yyyy"),
            HeureFin: end.toFormat("HH:mm"),
            startISO: start.toISO() ?? "N/A",
            endISO: end.toISO() ?? "N/A",
          };
          res.googleCreneaux = [
            ...(res.creneauxDouble.aller.startISO !== "N/A"
              ? [
                  {
                    start: res.creneauxDouble.aller.startISO,
                    end: res.creneauxDouble.aller.endISO,
                  },
                ]
              : []),
            {
              start: res.creneauxDouble.retour.startISO,
              end: res.creneauxDouble.retour.endISO,
            },
          ];
        }
      }
      return res;
    }

    return res;
  } catch (e) {
    console.error("[Creneaux] erreur:", (e as Error).message);
    return res;
  }
}
