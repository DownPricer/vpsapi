import { DateTime } from "luxon";
import { buildGcalUrl, resolveVtcBaseAddress } from "../pricing/calculator";
import type { TenantPricingEngineConfig } from "../pricing/engineTypes";
import type { Distances, TarifResult } from "../pricing/types";
import {
  airportAddressFrom,
  extractVille,
  getFormattedAddress,
  normalizeTCtrajet,
  normalizeTypeService,
} from "../pricing/utils";

const AR_MAD_CANON = "A/R + Mise à disposition";

function sanitizeInput(input: unknown): string {
  if (typeof input !== "string") return String(input ?? "");
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .trim();
}

function toMinutes(seconds: number): number {
  return Math.round((Number(seconds) || 0) / 60);
}

export interface ContactPayloadInput {
  client: { nom: string; prenom: string; telephone: string; email: string };
  commentaires?: string;
}

export function buildContactPayload(
  input: ContactPayloadInput,
  engine: TenantPricingEngineConfig
): Record<string, string> {
  const now = DateTime.now().setZone(engine.timezone);
  const id = `CON${now.toFormat("ddMMyy")}-${now.toFormat("HHmmss")}`;
  const nom = sanitizeInput(input.client.nom) || "N/A";
  const prenom = sanitizeInput(input.client.prenom) || "N/A";
  const telephone = sanitizeInput(input.client.telephone) || "N/A";
  const email = sanitizeInput(input.client.email) || "N/A";
  const commentaires = sanitizeInput(input.commentaires) || "N/A";

  return {
    ID: id,
    Nom: nom,
    Prenom: prenom,
    Telephone: telephone,
    Email: email,
    DateEnvoi: now.toFormat("dd/MM/yyyy HH:mm"),
    Etiquette: "CONTACT",
    Statut: "Attente contact",
    Commentaires: commentaires,
    Résumé: `DEMANDE DE CONTACT\nNom: ${nom}\nPrénom: ${prenom}\nTéléphone: ${telephone}\nEmail: ${email}\nCommentaires: ${commentaires}`,
    AdresseDepart_1_Original: "N/A",
    AdresseArrivee_1_Original: "N/A",
    AdresseDepart_2_Original: "N/A",
    AdresseArrivee_2_Original: "N/A",
    TypeTrajet: "N/A",
    NombrePassagers: "N/A",
    Payé: "Non",
    Options: "N/A",
    RésuméTrajet: "N/A",
    AdresseDepart_1: "N/A",
    AdresseArrivee_1: "N/A",
    VilleDepart_1: "N/A",
    VilleArrivee_1: "N/A",
    DateAller: "N/A",
    HeureAller: "N/A",
    DateRetour: "N/A",
    HeureRetour: "N/A",
    AdresseDepart_2: "N/A",
    AdresseArrivee_2: "N/A",
    VilleDepart_2: "N/A",
    VilleArrivee_2: "N/A",
    HeuresMAD: "N/A",
    AllerHeureVol: "N/A",
    AllerNumeroVol: "N/A",
    RetourHeureVol: "N/A",
    RetourNumeroVol: "N/A",
    AdresseEvenement: "N/A",
    DateDebut: "N/A",
    HeureDebut: "N/A",
    TarifTotal: "0.00",
    DistanceApprocheAllerKm: "0.00",
    DureeApprocheAllerMin: "0",
    DistanceTrajetAllerKm: "0.00",
    DureeTrajetAllerMin: "0",
    DistanceRetourBaseAllerKm: "0.00",
    DureeRetourBaseAllerMin: "0",
    DistanceApprocheRetourKm: "0.00",
    DureeApprocheRetourMin: "0",
    DistanceTrajetRetourKm: "0.00",
    DureeTrajetRetourMin: "0",
    DistanceRetourBaseRetourKm: "0.00",
    DureeRetourBaseRetourMin: "0",
    TarifApprocheAller: "0.00",
    TarifTrajetAller: "0.00",
    TarifRetourBaseAller: "0.00",
    TarifTotalAller: "0.00",
    TarifApprocheRetour: "0.00",
    TarifTrajetRetour: "0.00",
    TarifRetourBaseRetour: "0.00",
    TarifTotalRetour: "0.00",
    TarifMiseADisposition: "0.00",
    Majoration_1: "0.00",
    Majoration_2: "0.00",
    MajorationsTotal: "0.00",
    CreneauAllerDebut: "N/A",
    CreneauAllerFin: "N/A",
    CreneauRetourDebut: "N/A",
    CreneauRetourFin: "N/A",
    DebutCompletDispo: "N/A",
    FinCompletDispo: "N/A",
    GoogleCreneauAllerDebut: "N/A",
    GoogleCreneauAllerFin: "N/A",
    GoogleCreneauRetourDebut: "N/A",
    GoogleCreneauRetourFin: "N/A",
    CreneauAllerDebutDate: "N/A",
    CreneauAllerDebutHeure: "N/A",
    CreneauAllerFinDate: "N/A",
    CreneauAllerFinHeure: "N/A",
    CreneauRetourDebutDate: "N/A",
    CreneauRetourDebutHeure: "N/A",
    CreneauRetourFinDate: "N/A",
    CreneauRetourFinHeure: "N/A",
    CreneauAllerDateDebut: "N/A",
    CreneauAllerHeureDebut: "N/A",
    CreneauAllerDateFin: "N/A",
    CreneauAllerHeureFin: "N/A",
    CreneauRetourDateDebut: "N/A",
    CreneauRetourHeureDebut: "N/A",
    CreneauRetourDateFin: "N/A",
    CreneauRetourHeureFin: "N/A",
    GoogleCreneauFin: "N/A",
    GoogleCreneauDebut: "N/A",
    PaymentMethode: "N/A",
    Organisation: "N/A",
    NomSociete: "N/A",
    AdresseSociete: "N/A",
    "Invoice Status": "N/A",
    TypeService: "N/A",
    Observations: "N/A",
    DetailsMajorations: "N/A",
    MajorationMiseADisposition: "N/A",
    MajorationDispo: "N/A",
    NumeroVol_1: "N/A",
    HeuredVol_1: "N/A",
    NumeroVol_2: "N/A",
    HeureVol_2: "N/A",
    LieuEvenement: "N/A",
    VilleEvenement: "N/A",
    BagagesAller: "N/A",
    BagagesRetour: "N/A",
    NombreInvites: "N/A",
    GoogleCalendarSummary: "N/A",
    Summary: "N/A",
    AdresseBase: "N/A",
    HeuresMADEvenementiel: "N/A",
    DureeMADHeures: "N/A",
    DureeMADMinutes: "N/A",
    HeuresEvenement: "N/A",
    CreneauMADDebut: "N/A",
    CreneauMADFin: "N/A",
    MajorationNuitMAD: "0.00",
    MajorationDimancheMAD: "0.00",
    MajorationFerieMAD: "0.00",
    MajorationAller: "0.00",
    MajorationRetour: "0.00",
    MajorationTotal: "0.00",
    MajorationNuitAller: "0.00",
    MajorationDimancheAller: "0.00",
    MajorationFerieAller: "0.00",
    MajorationNuitRetour: "0.00",
    MajorationDimancheRetour: "0.00",
    MajorationFerieRetour: "0.00",
    DateCreation: now.toISO() ?? "",
  };
}

/** Extrait les champs plats depuis le payload nested (client, general, trajetClassique, etc.) */
export function getFlatFromNestedPayload(
  p: Record<string, unknown>,
  engine: TenantPricingEngineConfig
): Record<string, string> {
  const c = (p?.client || {}) as Record<string, string>;
  const g = (p?.general || {}) as Record<string, string>;
  const t = (p?.trajetClassique || {}) as Record<string, string>;
  const a = (p?.transfertAeroport || {}) as Record<string, string>;
  const e = (p?.madEvenementiel || {}) as Record<string, string>;
  const ts = normalizeTypeService(g?.TypeService);

  const flat: Record<string, string> = {
    Nom: getFormattedAddress(c?.nom) || "N/A",
    Prenom: getFormattedAddress(c?.prenom) || "N/A",
    Telephone: getFormattedAddress(c?.telephone) || "N/A",
    Email: getFormattedAddress(c?.email) || "N/A",
    NomSociete: getFormattedAddress(c?.nomSociete) || "N/A",
    AdresseSociete: getFormattedAddress(c?.adresseSociete) || "N/A",
    TypeService: ts || "Trajet Classique",
    TypeTrajet: normalizeTCtrajet(g?.TypeTrajet || t?.TCtrajet) || "Aller Simple",
    Commentaires: getFormattedAddress(g?.observations || g?.commentaires) || "N/A",
    BagagesAller: String(t?.TCbagagesaller ?? a?.TAbagagesaller ?? e?.nombreinvites ?? "0"),
    BagagesRetour: String(t?.TCbagagesretour ?? a?.TAbagagesretour ?? "0"),
    NombreInvites: String(e?.nombreinvites ?? "0"),
    HeuresMAD: t?.HeureMADClassique ?? "N/A",
    HeuresMADEvenementiel: String(e?.HeureMADEvenement ?? t?.HeureMADClassique ?? "0"),
    LieuEvenement: getFormattedAddress(e?.LieuEvenement) || "N/A",
    NombrePassagers: String(t?.TCpassagers ?? a?.TApassagers ?? "1"),
    Options: Array.isArray(g?.options) ? (g.options as string[]).join(", ") : "Aucun extra sélectionné",
    AllerHeureVol: a?.TAallerhoraire || "N/A",
    AllerNumeroVol: a?.TAallernumerovol || "N/A",
    RetourHeureVol: a?.TAretourhoraire || "N/A",
    RetourNumeroVol: a?.TAretournumerovol || "N/A",
  };

  if (ts === "Trajet Classique") {
    flat.AdresseDepart_1 = getFormattedAddress(t?.TCallerpriseencharge) || "N/A";
    flat.AdresseArrivee_1 = getFormattedAddress(t?.TCallerDestination) || "N/A";
    flat.DateAller = t?.TCallerdate || "N/A";
    flat.HeureAller = t?.TCallerheure || "N/A";
    const tct = normalizeTCtrajet(t?.TCtrajet);
    if (tct === "Aller/Retour" || tct === AR_MAD_CANON) {
      flat.AdresseDepart_2 = getFormattedAddress(t?.TCretourpriseencharge) || "N/A";
      flat.AdresseArrivee_2 = getFormattedAddress(t?.TCretourDestination) || "N/A";
      flat.DateRetour = t?.TCretourdate || "N/A";
      flat.HeureRetour = t?.TCretourheure || "N/A";
    } else {
      flat.AdresseDepart_2 = "N/A";
      flat.AdresseArrivee_2 = "N/A";
      flat.DateRetour = "N/A";
      flat.HeureRetour = "N/A";
    }
  } else if (ts === "Transfert Aéroport") {
    flat.AdresseDepart_1 =
      getFormattedAddress(airportAddressFrom(a?.TAallerpriseencharge, engine)) || "N/A";
    flat.AdresseArrivee_1 =
      getFormattedAddress(airportAddressFrom(a?.TAallerdestination, engine)) || "N/A";
    flat.DateAller = a?.TAallerdate || "N/A";
    flat.HeureAller = a?.TAallerhoraire || "N/A";
    if (a?.TAtrajet === "Aller/Retour") {
      flat.AdresseDepart_2 =
        getFormattedAddress(airportAddressFrom(a?.TAretourpriseencharge, engine)) || "N/A";
      flat.AdresseArrivee_2 =
        getFormattedAddress(airportAddressFrom(a?.TAretourdestination, engine)) || "N/A";
      flat.DateRetour = a?.TAretourdate || "N/A";
      flat.HeureRetour = a?.TAretourhoraire || "N/A";
    } else {
      flat.AdresseDepart_2 = "N/A";
      flat.AdresseArrivee_2 = "N/A";
      flat.DateRetour = "N/A";
      flat.HeureRetour = "N/A";
    }
  } else if (ts === "MAD Evenementiel") {
    flat.AdresseDepart_1 = engine.depotAddress;
    flat.AdresseArrivee_1 = getFormattedAddress(e?.LieuEvenement) || "N/A";
    flat.AdresseDepart_2 = "N/A";
    flat.AdresseArrivee_2 = "N/A";
    flat.DateAller = e?.DateEvenement || "N/A";
    flat.HeureAller = e?.HeureEvenement || "N/A";
    flat.DateRetour = "N/A";
    flat.HeureRetour = "N/A";
  } else {
    flat.AdresseDepart_1 = "N/A";
    flat.AdresseArrivee_1 = "N/A";
    flat.AdresseDepart_2 = "N/A";
    flat.AdresseArrivee_2 = "N/A";
    flat.DateAller = "N/A";
    flat.HeureAller = "N/A";
    flat.DateRetour = "N/A";
    flat.HeureRetour = "N/A";
  }

  return flat;
}

export interface ReservationPayloadInput {
  payload: Record<string, unknown>;
  result: TarifResult;
  engine: TenantPricingEngineConfig;
  paymentMethod?: string;
  paye?: string;
}

export function buildReservationPayload(input: ReservationPayloadInput): Record<string, string> {
  const { payload, result, engine, paymentMethod = "N/A", paye = "Non" } = input;
  const flat = getFlatFromNestedPayload(payload, engine);
  const now = DateTime.now().setZone(engine.timezone);
  const reservationId = `RES${now.toFormat("ddMMyy-HHmmss")}`;
  const dateCreation = now.toISO();
  const organisation =
    flat.NomSociete && flat.NomSociete !== "N/A" ? "Professionnel" : "Particulier";

  const fmt = (x: number | undefined) => Number(x) || 0;
  const tarifs = result.tarifs as Record<string, number | Record<string, number>>;
  const tarifsAller = (tarifs?.aller || {}) as Record<string, number>;
  const tarifsRetour = (tarifs?.retour || {}) as Record<string, number>;
  const maj = result.majorations || [];
  const majAller = maj.find((m) => m.leg === "aller")?.montant ?? 0;
  const majRetour = maj.find((m) => m.leg === "retour")?.montant ?? 0;
  const majMAD = maj.find((m) => m.leg === "miseADisposition")?.montant ?? 0;
  const majTotal = majAller + majRetour + majMAD;

  const safeCren = {
    aller: result.creneauxDouble?.aller?.startISO !== "N/A"
      ? result.creneauxDouble.aller
      : { DateDebut: result.creneauGlobal?.DateDebut ?? "N/A", HeureDebut: result.creneauGlobal?.HeureDebut ?? "N/A", DateFin: result.creneauGlobal?.DateFin ?? "N/A", HeureFin: result.creneauGlobal?.HeureFin ?? "N/A" },
    retour: result.creneauxDouble?.retour ?? { DateDebut: "N/A", HeureDebut: "N/A", DateFin: "N/A", HeureFin: "N/A" },
    miseADisposition: { DateDebut: result.creneauGlobal?.DateDebut ?? "N/A", HeureDebut: result.creneauGlobal?.HeureDebut ?? "N/A", DateFin: result.creneauGlobal?.DateFin ?? "N/A", HeureFin: result.creneauGlobal?.HeureFin ?? "N/A" },
  };

  const d = result.distances;
  const résuméTrajet =
    flat.TypeService === "MAD Evenementiel"
      ? `${extractVille(flat.LieuEvenement)} / M.A.D Évènementiel ${flat.HeuresMADEvenementiel}H`
      : `${extractVille(flat.AdresseDepart_1)} - ${extractVille(flat.AdresseArrivee_1)}${flat.TypeTrajet !== "Aller Simple" ? ` / Retour: ${extractVille(flat.AdresseDepart_2)} - ${extractVille(flat.AdresseArrivee_2)}` : ""}`;

  const resumeText = `Réservation ${reservationId}
Client: ${flat.Nom} ${flat.Prenom}
Type: ${flat.TypeService} — ${flat.TypeTrajet}
Trajet: ${résuméTrajet}
Tarif: ${(result.tarif || 0).toFixed(2)} €`;

  const gc0 = result.googleCreneaux?.[0];
  const gc1 = result.googleCreneaux?.[1];

  return {
    Organisation: organisation,
    NomSociete: flat.NomSociete,
    AdresseSociete: flat.AdresseSociete,
    "Invoice Status": "N/A",
    ID: reservationId,
    Nom: flat.Nom,
    Prenom: flat.Prenom,
    Telephone: flat.Telephone,
    Email: flat.Email,
    TypeService: flat.TypeService,
    DateEnvoi: now.toFormat("dd/MM/yyyy HH:mm"),
    AdresseDepart_1_Original: flat.AdresseDepart_1,
    AdresseArrivee_1_Original: flat.AdresseArrivee_1,
    AdresseDepart_2_Original: flat.AdresseDepart_2,
    AdresseArrivee_2_Original: flat.AdresseArrivee_2,
    TypeTrajet: flat.TypeTrajet,
    Etiquette: "Formulaire",
    NombrePassagers: flat.NombrePassagers,
    Statut: "En attente de confirmation",
    Payé: paye,
    PaymentMethode: paymentMethod,
    Observations: flat.Commentaires,
    Options: flat.Options,
    Résumé: resumeText,
    RésuméTrajet: résuméTrajet,
    Summary: resumeText,
    GoogleCalendarSummary: resumeText,

    AdresseDepart_1: flat.AdresseDepart_1,
    AdresseArrivee_1: flat.AdresseArrivee_1,
    VilleDepart_1: extractVille(flat.AdresseDepart_1),
    VilleArrivee_1: extractVille(flat.AdresseArrivee_1),
    AdresseDepart_2: flat.AdresseDepart_2,
    AdresseArrivee_2: flat.AdresseArrivee_2,
    VilleDepart_2: extractVille(flat.AdresseDepart_2),
    VilleArrivee_2: extractVille(flat.AdresseArrivee_2),

    DateAller: flat.DateAller,
    HeureAller: flat.HeureAller,
    DateRetour: flat.DateRetour,
    HeureRetour: flat.HeureRetour,

    HeuresMAD: (flat.HeuresMAD !== "N/A" ? flat.HeuresMAD : flat.HeuresMADEvenementiel) || "N/A",
    AllerHeureVol: flat.AllerHeureVol,
    AllerNumeroVol: flat.AllerNumeroVol,
    RetourHeureVol: flat.RetourHeureVol,
    RetourNumeroVol: flat.RetourNumeroVol,

    TarifTotal: (result.tarif || 0).toFixed(2),
    DistanceApprocheAllerKm: (d?.aller?.approche?.km ?? 0).toFixed(2),
    DureeApprocheAllerMin: String(toMinutes(d?.aller?.approche?.duree ?? 0)),
    DistanceTrajetAllerKm: (d?.aller?.trajet?.km ?? 0).toFixed(2),
    DureeTrajetAllerMin: String(toMinutes(d?.aller?.trajet?.duree ?? 0)),
    DistanceRetourBaseAllerKm: (d?.aller?.retourBase?.km ?? 0).toFixed(2),
    DureeRetourBaseAllerMin: String(toMinutes(d?.aller?.retourBase?.duree ?? 0)),
    DistanceApprocheRetourKm: (d?.retour?.approche?.km ?? 0).toFixed(2),
    DureeApprocheRetourMin: String(toMinutes(d?.retour?.approche?.duree ?? 0)),
    DistanceTrajetRetourKm: (d?.retour?.trajet?.km ?? 0).toFixed(2),
    DureeTrajetRetourMin: String(toMinutes(d?.retour?.trajet?.duree ?? 0)),
    DistanceRetourBaseRetourKm: (d?.retour?.retourBase?.km ?? 0).toFixed(2),
    DureeRetourBaseRetourMin: String(toMinutes(d?.retour?.retourBase?.duree ?? 0)),

    TarifApprocheAller: (tarifsAller?.approche ?? 0).toFixed(2),
    TarifTrajetAller: (tarifsAller?.trajet ?? 0).toFixed(2),
    TarifRetourBaseAller: (tarifsAller?.retourBase ?? 0).toFixed(2),
    TarifTotalAller: (fmt(tarifsAller?.total) + majAller).toFixed(2),
    TarifApprocheRetour: (tarifsRetour?.approche ?? 0).toFixed(2),
    TarifTrajetRetour: (tarifsRetour?.trajet ?? 0).toFixed(2),
    TarifRetourBaseRetour: (tarifsRetour?.retourBase ?? 0).toFixed(2),
    TarifTotalRetour: (fmt(tarifsRetour?.total) + majRetour).toFixed(2),
    TarifMiseADisposition: (Number(tarifs?.miseADisposition) || 0).toFixed(2),

    Majoration_1: majAller.toFixed(2),
    Majoration_2: majRetour.toFixed(2),
    MajorationsTotal: majTotal.toFixed(2),
    DetailsMajorations: `Aller: ${majAller.toFixed(2)} | Retour: ${majRetour.toFixed(2)} | MAD: ${majMAD.toFixed(2)}`,
    MajorationAller: majAller.toFixed(2),
    MajorationRetour: majRetour.toFixed(2),
    MajorationMiseADisposition: majMAD.toFixed(2),
    MajorationNuitAller: "0.00",
    MajorationDimancheAller: "0.00",
    MajorationFerieAller: "0.00",
    MajorationNuitRetour: "0.00",
    MajorationDimancheRetour: "0.00",
    MajorationFerieRetour: "0.00",
    MajorationNuitMAD: "0.00",
    MajorationDimancheMAD: "0.00",
    MajorationFerieMAD: "0.00",

    CreneauAllerDateDebut: safeCren.aller.DateDebut ?? "N/A",
    CreneauAllerHeureDebut: safeCren.aller.HeureDebut ?? "N/A",
    CreneauAllerDateFin: safeCren.aller.DateFin ?? "N/A",
    CreneauAllerHeureFin: safeCren.aller.HeureFin ?? "N/A",
    CreneauRetourDateDebut: (safeCren.retour as Record<string, string>)?.DateDebut ?? "N/A",
    CreneauRetourHeureDebut: (safeCren.retour as Record<string, string>)?.HeureDebut ?? "N/A",
    CreneauRetourDateFin: (safeCren.retour as Record<string, string>)?.DateFin ?? "N/A",
    CreneauRetourHeureFin: (safeCren.retour as Record<string, string>)?.HeureFin ?? "N/A",
    DebutCompletDispo: safeCren.miseADisposition.DateDebut,
    FinCompletDispo: safeCren.miseADisposition.DateFin,
    GoogleCreneauAllerDebut: gc0?.start ?? "N/A",
    GoogleCreneauAllerFin: gc0?.end ?? "N/A",
    GoogleCreneauRetourDebut: gc1?.start ?? "N/A",
    GoogleCreneauRetourFin: gc1?.end ?? "N/A",
    GoogleCreneauDebut: gc0?.start ?? "N/A",
    GoogleCreneauFin: gc0?.end ?? "N/A",

    CreneauMADDebut: `${safeCren.miseADisposition.DateDebut} ${safeCren.miseADisposition.HeureDebut}`,
    CreneauMADFin: `${safeCren.miseADisposition.DateFin} ${safeCren.miseADisposition.HeureFin}`,

    DateCreation: dateCreation ?? "",
    AdresseBase: engine.depotAddress,
    LieuEvenement: flat.LieuEvenement,
    VilleEvenement: extractVille(flat.LieuEvenement),
    HeuresMADEvenementiel: flat.HeuresMADEvenementiel,
    DureeMADHeures: flat.HeuresMADEvenementiel,
    DureeMADMinutes: String(parseInt(flat.HeuresMADEvenementiel || "0") * 60),
    HeuresEvenement: flat.HeuresMADEvenementiel,

    BagagesAller: flat.BagagesAller,
    BagagesRetour: flat.BagagesRetour,
    NombreInvites: flat.NombreInvites,
    Commentaires: flat.Commentaires,

    "Event ID Aller": "",
    "Event ID Retour": "",
  };
}

export interface DevisPayloadInput {
  payload: Record<string, unknown>;
  result: TarifResult;
  distances: Distances;
  engine: TenantPricingEngineConfig;
}

export function buildDevisPayload(input: DevisPayloadInput): Record<string, string> {
  const { payload, result, distances, engine } = input;
  const flat = getFlatFromNestedPayload(payload, engine);
  const baseAddr = resolveVtcBaseAddress(payload, engine);
  const now = DateTime.now().setZone(engine.timezone);
  const devisId = `DEV${now.toFormat("ddMMyy-HHmmss")}`;
  const tarifs = result.tarifs as Record<string, number | Record<string, number>>;
  const tarifsAller = (tarifs?.aller || {}) as Record<string, number>;
  const tarifsRetour = (tarifs?.retour || {}) as Record<string, number>;
  const maj = result.majorations || [];
  const maj0 = maj[0]?.montant ?? 0;
  const maj1 = maj[1]?.montant ?? 0;
  const majTotal = maj.reduce((s, m) => s + (m?.montant ?? 0), 0);

  const typeClient = (payload?.client as Record<string, string>)?.organisation === "Professionnel" ? "Professionnel" : "Particulier";
  const isPro = typeClient === "Professionnel";
  const optionsValue = Array.isArray((payload?.general as Record<string, unknown>)?.options)
    ? ((payload?.general as Record<string, unknown>).options as string[]).join(", ")
    : "Aucun extra sélectionné";
  const observationsValue =
    ((payload?.general as Record<string, string>)?.observations || (payload?.general as Record<string, string>)?.commentaires || "N/A") as string;

  let résuméTrajet = "N/A";
  if (flat.TypeService === "MAD Evenementiel") {
    résuméTrajet = `M.A.D évènementiel — ${baseAddr} → ${flat.LieuEvenement}`;
  } else if (flat.TypeService === "Trajet Classique") {
    let part1 = `${flat.AdresseDepart_1} → ${flat.AdresseArrivee_1}`;
    if (flat.TypeTrajet !== "Aller Simple") {
      part1 += ` // ${flat.AdresseDepart_2} → ${flat.AdresseArrivee_2}`;
    }
    résuméTrajet = `${flat.TypeTrajet} — ${part1}`;
  } else if (flat.TypeService === "Transfert Aéroport") {
    let part1 = `${flat.AdresseDepart_1} → ${flat.AdresseArrivee_1}`;
    if (flat.DateRetour !== "N/A") part1 += ` // ${flat.AdresseDepart_2} → ${flat.AdresseArrivee_2}`;
    résuméTrajet = part1;
  }

  const resumeText = `DEMANDE DE DEVIS
Type: ${flat.TypeService}
Client: ${flat.Nom} ${flat.Prenom}
Organisation: ${typeClient}${isPro ? ` — Société: ${flat.NomSociete} (${flat.AdresseSociete})` : ""}`;

  const devis: Record<string, string> = {
    ID: devisId,
    Nom: flat.Nom,
    Prenom: flat.Prenom,
    Telephone: flat.Telephone,
    Email: flat.Email,
    Organisation: typeClient,
    TypeClient: typeClient,
    NomSociete: flat.NomSociete,
    AdresseSociete: flat.AdresseSociete,
    DateEnvoi: now.toFormat("dd/MM/yyyy HH:mm"),
    TypeService: flat.TypeService,
    Etiquette: "Devis",
    Statut: "En attente de confirmation",
    Payé: "Non",
    PaymentMethode: "N/A",
    Commentaires: observationsValue,
    Options: optionsValue,
    Résumé: resumeText,
    RésuméTrajet: résuméTrajet,
    DateCreation: now.toISO() ?? "",
    AdresseBase: baseAddr,
    DetailsMajorations: JSON.stringify(maj),
    Majoration_1: maj0.toFixed(2),
    Majoration_2: maj1.toFixed(2),
    MajorationsTotal: majTotal.toFixed(2),
    GoogleCreneaux: JSON.stringify(result.googleCreneaux || []),
    TarifTotal: (result.tarif || 0).toFixed(2),
    TypeTrajet: flat.TypeTrajet,
    NombrePassagers: flat.NombrePassagers,
    AdresseDepart_1: flat.AdresseDepart_1,
    AdresseArrivee_1: flat.AdresseArrivee_1,
    VilleDepart_1: extractVille(flat.AdresseDepart_1),
    VilleArrivee_1: extractVille(flat.AdresseArrivee_1),
    AdresseDepart_2: flat.AdresseDepart_2,
    AdresseArrivee_2: flat.AdresseArrivee_2,
    VilleDepart_2: extractVille(flat.AdresseDepart_2),
    VilleArrivee_2: extractVille(flat.AdresseArrivee_2),
    DateAller: flat.DateAller,
    HeureAller: flat.HeureAller,
    DateRetour: flat.DateRetour,
    HeureRetour: flat.HeureRetour,
    HeuresMAD: (flat.HeuresMAD !== "N/A" ? flat.HeuresMAD : flat.HeuresMADEvenementiel) || "N/A",
    LieuEvenement: flat.LieuEvenement,
    VilleEvenement: extractVille(flat.LieuEvenement),
    NombreInvites: flat.NombreInvites,
    DistanceApprocheAllerKm: (distances?.aller?.approche?.km ?? 0).toFixed(2),
    DureeApprocheAllerMin: String(toMinutes(distances?.aller?.approche?.duree ?? 0)),
    DistanceTrajetAllerKm: (distances?.aller?.trajet?.km ?? 0).toFixed(2),
    DureeTrajetAllerMin: String(toMinutes(distances?.aller?.trajet?.duree ?? 0)),
    DistanceRetourBaseAllerKm: (distances?.aller?.retourBase?.km ?? 0).toFixed(2),
    DureeRetourBaseAllerMin: String(toMinutes(distances?.aller?.retourBase?.duree ?? 0)),
    DistanceApprocheRetourKm: (distances?.retour?.approche?.km ?? 0).toFixed(2),
    DureeApprocheRetourMin: String(toMinutes(distances?.retour?.approche?.duree ?? 0)),
    DistanceTrajetRetourKm: (distances?.retour?.trajet?.km ?? 0).toFixed(2),
    DureeTrajetRetourMin: String(toMinutes(distances?.retour?.trajet?.duree ?? 0)),
    DistanceRetourBaseRetourKm: (distances?.retour?.retourBase?.km ?? 0).toFixed(2),
    DureeRetourBaseRetourMin: String(toMinutes(distances?.retour?.retourBase?.duree ?? 0)),
    TarifApprocheAller: (tarifsAller?.approche ?? 0).toFixed(2),
    TarifTrajetAller: (tarifsAller?.trajet ?? 0).toFixed(2),
    TarifRetourBaseAller: (tarifsAller?.retourBase ?? 0).toFixed(2),
    TarifApprocheRetour: (tarifsRetour?.approche ?? 0).toFixed(2),
    TarifTrajetRetour: (tarifsRetour?.trajet ?? 0).toFixed(2),
    TarifRetourBaseRetour: (tarifsRetour?.retourBase ?? 0).toFixed(2),
    TarifMiseADisposition: (Number(tarifs?.miseADisposition) || 0).toFixed(2),
    TarifTotalAller: ((tarifsAller?.total ?? 0) + maj0).toFixed(2),
    TarifTotalRetour: ((Number(tarifsRetour?.total) || 0) + maj1).toFixed(2),
    CreneauAllerDateDebut: result.creneauxDouble?.aller?.DateDebut ?? result.creneauGlobal?.DateDebut ?? "N/A",
    CreneauAllerHeureDebut: result.creneauxDouble?.aller?.HeureDebut ?? result.creneauGlobal?.HeureDebut ?? "N/A",
    CreneauAllerDateFin: result.creneauxDouble?.aller?.DateFin ?? result.creneauGlobal?.DateFin ?? "N/A",
    CreneauAllerHeureFin: result.creneauxDouble?.aller?.HeureFin ?? result.creneauGlobal?.HeureFin ?? "N/A",
    CreneauRetourDateDebut: result.creneauxDouble?.retour?.DateDebut ?? "N/A",
    CreneauRetourHeureDebut: result.creneauxDouble?.retour?.HeureDebut ?? "N/A",
    CreneauRetourDateFin: result.creneauxDouble?.retour?.DateFin ?? "N/A",
    CreneauRetourHeureFin: result.creneauxDouble?.retour?.HeureFin ?? "N/A",
    CreneauGlobalDateDebut: result.creneauGlobal?.DateDebut ?? "N/A",
    CreneauGlobalHeureDebut: result.creneauGlobal?.HeureDebut ?? "N/A",
    CreneauGlobalDateFin: result.creneauGlobal?.DateFin ?? "N/A",
    CreneauGlobalHeureFin: result.creneauGlobal?.HeureFin ?? "N/A",
    GoogleCreneauDebut: result.creneauGlobal?.startISO ?? result.creneauxDouble?.aller?.startISO ?? "N/A",
    GoogleCreneauFin: result.creneauGlobal?.endISO ?? result.creneauxDouble?.aller?.endISO ?? "N/A",
    GoogleCreneauAllerDebut: result.creneauxDouble?.aller?.startISO ?? result.creneauGlobal?.startISO ?? "N/A",
    GoogleCreneauAllerFin: result.creneauxDouble?.aller?.endISO ?? result.creneauGlobal?.endISO ?? "N/A",
    GoogleCreneauRetourDebut: result.creneauxDouble?.retour?.startISO ?? "N/A",
    GoogleCreneauRetourFin: result.creneauxDouble?.retour?.endISO ?? "N/A",
  };

  const gcDetails = `ID: ${devisId}\nClient: ${flat.Nom} ${flat.Prenom}\nType: ${flat.TypeService}`;
  if (result.creneauGlobal?.startISO && result.creneauGlobal?.startISO !== "N/A" && result.creneauGlobal?.endISO && result.creneauGlobal?.endISO !== "N/A") {
    devis.GoogleCalendarUrl = buildGcalUrl(
      {
        startISO: result.creneauGlobal.startISO,
        endISO: result.creneauGlobal.endISO,
        title: `Course — ${flat.VilleDepart_1 || "Trajet"} → ${flat.VilleArrivee_1 || ""}`,
        details: gcDetails,
        location: flat.AdresseDepart_1 || "",
      },
      engine
    ) ?? "N/A";
  }
  if (result.creneauxDouble?.aller?.startISO && result.creneauxDouble?.aller?.startISO !== "N/A") {
    devis.GoogleCalendarUrlAller = buildGcalUrl(
      {
        startISO: result.creneauxDouble.aller.startISO,
        endISO: result.creneauxDouble.aller.endISO,
        title: `Course (Aller) — ${extractVille(flat.AdresseDepart_1)} → ${extractVille(flat.AdresseArrivee_1)}`,
        details: gcDetails,
        location: flat.AdresseDepart_1 || "",
      },
      engine
    ) ?? "N/A";
  }
  if (result.creneauxDouble?.retour?.startISO && result.creneauxDouble?.retour?.startISO !== "N/A") {
    devis.GoogleCalendarUrlRetour = buildGcalUrl(
      {
        startISO: result.creneauxDouble.retour.startISO,
        endISO: result.creneauxDouble.retour.endISO,
        title: `Course (Retour) — ${extractVille(flat.AdresseDepart_2)} → ${extractVille(flat.AdresseArrivee_2)}`,
        details: gcDetails,
        location: flat.AdresseDepart_2 || "",
      },
      engine
    ) ?? "N/A";
  }

  return devis;
}
