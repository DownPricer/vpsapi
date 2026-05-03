import { randomUUID } from "node:crypto";
import type { TenantPricingEngineConfig } from "./engineTypes";
import type { Distances, TarifResult } from "./types";
import {
  airportAddressFrom,
  airportCodeFromAddress,
  getFormattedAddress,
  normalizeTCtrajet,
  normalizeTypeService,
} from "./utils";
import { resolveVtcBaseAddress } from "./calculator";

export type PricingDebugSegmentSource = "distanceMatrix" | "fallback" | "manual";

export type PricingDebugBreakdown = {
  requestId: string;
  tenantId: string;
  createdAt: string;
  serviceType: string;
  tripType?: string;
  vtcBaseAddressUsed: string;
  /** Indique si la base vient du payload (`vtcBaseAddress`) ou du repli moteur (`depotAddress`). */
  vtcBaseAddressSource: "payload" | "engine_fallback";
  pickupAddress?: string;
  destinationAddress?: string;
  airportCode?: string;
  options: string[];
  segments: Array<{
    label: string;
    from: string;
    to: string;
    distanceKm?: number;
    durationMin?: number;
    source?: PricingDebugSegmentSource;
  }>;
  pricingSteps: Array<{
    label: string;
    amount?: number;
    detail?: string;
  }>;
  rulesApplied: string[];
  totals: {
    distanceKm?: number;
    durationMin?: number;
    subtotal?: number;
    total: number;
  };
};

function segSource(
  km: number | undefined,
  dureeSec: number | undefined,
  from: string,
  to: string
): PricingDebugSegmentSource {
  const f = (from || "").trim();
  const t = (to || "").trim();
  if (f && t && f !== "N/A" && t !== "N/A" && f !== t && (km ?? 0) === 0 && (dureeSec ?? 0) === 0) {
    return "fallback";
  }
  return "distanceMatrix";
}

function pushSeg(
  out: PricingDebugBreakdown["segments"],
  label: string,
  from: string,
  to: string,
  seg: { km?: number; duree?: number }
) {
  const km = seg.km ?? 0;
  const duree = seg.duree ?? 0;
  out.push({
    label,
    from: getFormattedAddress(from),
    to: getFormattedAddress(to),
    distanceKm: Math.round(km * 100) / 100,
    durationMin: Math.round(duree / 60),
    source: segSource(seg.km, seg.duree, getFormattedAddress(from), getFormattedAddress(to)),
  });
}

function sumDistances(d: Distances): { km: number; min: number } {
  let km = 0;
  let sec = 0;
  const legs: Array<keyof Distances> = ["aller", "retour"];
  const parts = ["approche", "trajet", "retourBase"] as const;
  for (const leg of legs) {
    for (const p of parts) {
      const s = d[leg][p];
      km += s.km ?? 0;
      sec += s.duree ?? 0;
    }
  }
  return { km, min: Math.round(sec / 60) };
}

function tarifSteps(tarifs: Record<string, unknown>): PricingDebugBreakdown["pricingSteps"] {
  const steps: PricingDebugBreakdown["pricingSteps"] = [];
  const addObj = (prefix: string, o: Record<string, number>) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
        steps.push({ label: `${prefix} — ${k}`, amount: Math.round(v * 100) / 100 });
      }
    }
  };
  const aller = tarifs.aller;
  const retour = tarifs.retour;
  if (aller && typeof aller === "object" && !Array.isArray(aller)) {
    addObj("Aller", aller as Record<string, number>);
  }
  if (retour && typeof retour === "object" && !Array.isArray(retour)) {
    addObj("Retour", retour as Record<string, number>);
  }
  const mad = tarifs.miseADisposition;
  if (typeof mad === "number" && mad > 0) {
    steps.push({ label: "Mise à disposition (horaire)", amount: Math.round(mad * 100) / 100 });
  }
  const tot = tarifs.total;
  if (typeof tot === "number") {
    steps.push({ label: "Total brut (avant arrondi affichage)", amount: Math.round(tot * 100) / 100 });
  }
  return steps;
}

export function buildPricingDebugBreakdown(input: {
  tenantId: string;
  typeKey: string;
  body: Record<string, unknown>;
  engine: TenantPricingEngineConfig;
  distances: Distances;
  result: TarifResult;
}): PricingDebugBreakdown {
  const { tenantId, typeKey, body, engine, distances, result } = input;
  const g = (body.general || {}) as Record<string, unknown>;
  const serviceType = String(g.TypeService ?? "");
  const tripType = g.TypeTrajet != null ? String(g.TypeTrajet) : undefined;
  const opts = Array.isArray(g.options) ? (g.options as unknown[]).map((x) => String(x)) : [];

  const rawPayloadBase = body.vtcBaseAddress;
  const fromPayload =
    typeof rawPayloadBase === "string" && rawPayloadBase.trim().length > 0;
  const vtcBaseAddressUsed = resolveVtcBaseAddress(body, engine);

  const segments: PricingDebugBreakdown["segments"] = [];
  const ts = normalizeTypeService(serviceType);
  const base = vtcBaseAddressUsed;

  let pickupAddress: string | undefined;
  let destinationAddress: string | undefined;
  let airportCode: string | undefined;

  if (ts === "Trajet Classique") {
    const t = (body.trajetClassique || {}) as Record<string, string>;
    pickupAddress = getFormattedAddress(t.TCallerpriseencharge);
    destinationAddress = getFormattedAddress(t.TCallerDestination);
    const tct = normalizeTCtrajet(t.TCtrajet);
    pushSeg(segments, "Aller — approche (base → prise en charge)", base, t.TCallerpriseencharge, distances.aller.approche);
    pushSeg(segments, "Aller — trajet client", t.TCallerpriseencharge, t.TCallerDestination, distances.aller.trajet);
    pushSeg(segments, "Aller — retour base (destination → base)", t.TCallerDestination, base, distances.aller.retourBase);
    if (tct === "Aller/Retour" || tct === "A/R + Mise à disposition") {
      pushSeg(segments, "Retour — approche", base, t.TCretourpriseencharge, distances.retour.approche);
      pushSeg(segments, "Retour — trajet", t.TCretourpriseencharge, t.TCretourDestination, distances.retour.trajet);
      pushSeg(segments, "Retour — retour base", t.TCretourDestination, base, distances.retour.retourBase);
    }
  } else if (ts === "Transfert Aéroport") {
    const a = (body.transfertAeroport || {}) as Record<string, string>;
    const p1 = airportAddressFrom(a.TAallerpriseencharge, engine);
    const d1 = airportAddressFrom(a.TAallerdestination, engine);
    pickupAddress = getFormattedAddress(p1);
    destinationAddress = getFormattedAddress(d1);
    const ac = (a as { aeroportDepartCode?: string }).aeroportDepartCode;
    airportCode = typeof ac === "string" && ac.trim() ? ac.trim() : undefined;
    if (!airportCode) {
      const inferred = airportCodeFromAddress(d1, engine) ?? airportCodeFromAddress(p1, engine);
      if (inferred) airportCode = inferred;
    }
    pushSeg(segments, "Aller — approche (base → point A)", base, p1, distances.aller.approche);
    pushSeg(segments, "Aller — trajet", p1, d1, distances.aller.trajet);
    pushSeg(segments, "Aller — retour base", d1, base, distances.aller.retourBase);
    if (a.TAtrajet === "Aller/Retour") {
      const p2 = airportAddressFrom(a.TAretourpriseencharge, engine);
      const d2 = airportAddressFrom(a.TAretourdestination, engine);
      pushSeg(segments, "Retour — approche", base, p2, distances.retour.approche);
      pushSeg(segments, "Retour — trajet", p2, d2, distances.retour.trajet);
      pushSeg(segments, "Retour — retour base", d2, base, distances.retour.retourBase);
    }
  } else if (ts === "MAD Evenementiel") {
    const e = (body.madEvenementiel || {}) as Record<string, string>;
    const L = e.LieuEvenement;
    destinationAddress = getFormattedAddress(L);
    pickupAddress = base;
    pushSeg(segments, "MAD — aller (base → lieu)", base, L, distances.aller.approche);
    pushSeg(segments, "MAD — retour base (lieu → base)", L, base, distances.aller.retourBase);
  }

  const { km: totalKm, min: totalMin } = sumDistances(distances);
  const tarifs = result.tarifs as Record<string, unknown>;
  const pricingSteps = tarifSteps(tarifs);
  for (const m of result.majorations || []) {
    if (m.montant > 0) {
      pricingSteps.push({
        label: `Majoration (${m.leg})`,
        amount: m.montant,
        detail: "Règles nuit / week-end / férié ou saisie manuelle (moteur)",
      });
    }
  }

  const rulesApplied: string[] = [
    `Moteur : timezone=${engine.timezone}`,
    `Zone service préférentielle : ${engine.primaryServiceZoneSetId}`,
    `Coeff. hors zone : ×${engine.outOfPrimaryServiceZoneMultiplier}`,
    `Remise A/R moteur : ${engine.applyArDiscount ? "oui (-5 % si applicable)" : "non"}`,
    `Minimum MAD (config) : ${engine.madEventMinimumTotal} €`,
  ];

  const subtotal =
    typeof tarifs.total === "number" ? tarifs.total : undefined;

  return {
    requestId: randomUUID(),
    tenantId,
    createdAt: new Date().toISOString(),
    serviceType,
    tripType,
    vtcBaseAddressUsed,
    vtcBaseAddressSource: fromPayload ? "payload" : "engine_fallback",
    pickupAddress,
    destinationAddress,
    airportCode: airportCode ? String(airportCode) : undefined,
    options: opts,
    segments,
    pricingSteps,
    rulesApplied,
    totals: {
      distanceKm: Math.round(totalKm * 100) / 100,
      durationMin: totalMin,
      subtotal: subtotal != null ? Math.round(subtotal * 100) / 100 : undefined,
      total: result.tarif,
    },
  };
}
