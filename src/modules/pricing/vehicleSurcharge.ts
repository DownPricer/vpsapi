/**
 * Supplément tarifaire par véhicule — SEULE implémentation (le frontend n'a aucun moteur de prix).
 *
 * Règle d'application (ordre fixe, voir docs/FLOTTE_VEHICULES.md) :
 *   1. le moteur calcule le tarif métier (grilles, majorations, remises A/R, hors zone, minimum, arrondi existant) → `tarifBase`;
 *   2. le calculateur expose l'assiette kilométrique (`VehicleSurchargeBasis`) de ce même calcul;
 *   3. le supplément véhicule est calculé ICI sur cette assiette, jamais sur le total, et AJOUTÉ à `tarifBase`;
 *   4. total = tarifBase + supplément (le minimum tarifaire s'applique donc au tarif métier, pas au supplément).
 *
 * Modes :
 *   - none        : supplément 0.
 *   - fixed       : `value` € ajoutés une fois par réservation (quel que soit le type de course).
 *   - per_km      : `value` €/km × `billableKm` (km réellement facturés par le moteur, approche et retour dépôt inclus
 *                   s'ils sont facturés, toutes branches d'un aller-retour comprises). Mise à disposition horaire pure : 0 km → 0 €.
 *   - percent_km  : `value` % × `kmAmount`, où `kmAmount` = montant kilométrique du tarif (approche + trajet + retour dépôt,
 *                   toutes branches), après remise A/R et coefficient hors zone, hors mise à disposition horaire et hors
 *                   majorations horaires. Le pourcentage est appliqué UNE seule fois à cette assiette en euros : il n'est
 *                   jamais multiplié par le nombre de kilomètres.
 */

export type VehicleSurchargeMode = "none" | "fixed" | "per_km" | "percent_km";

export interface VehiclePricingConfig {
  mode: VehicleSurchargeMode;
  /** fixed : €, per_km : €/km, percent_km : % (0–100). */
  value: number;
}

export interface VehicleSurchargeBasis {
  /** false pour une prestation sans composante kilométrique (mise à disposition événementielle). */
  kmApplicable: boolean;
  /** Kilomètres facturés par le moteur (approche + trajet + retour dépôt si facturé, toutes branches). */
  billableKm: number;
  /** Montant € de la composante kilométrique (après remise A/R et coefficient hors zone). */
  kmAmount: number;
}

export interface VehicleSurchargeResult {
  mode: VehicleSurchargeMode;
  value: number;
  /** Supplément en euros, ≥ 0. */
  amount: number;
  /** false quand le mode choisi n'a pas d'assiette pour cette course (supplément = 0 et `note` l'explique). */
  applicable: boolean;
  /** Détail du calcul, affiché dans le récapitulatif. */
  formula: string;
  note?: string;
}

const EPS = 1e-9;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Arrondi à l'euro supérieur, cohérent avec les arrondis `Math.ceil` du moteur existant. */
const ceilEuro = (n: number): number => Math.max(0, Math.ceil(round2(n) - EPS));

const sanitize = (n: unknown): number => {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function emptyBasis(): VehicleSurchargeBasis {
  return { kmApplicable: false, billableKm: 0, kmAmount: 0 };
}

export function computeVehicleSurcharge(
  config: VehiclePricingConfig,
  basis: VehicleSurchargeBasis | null | undefined
): VehicleSurchargeResult {
  const value = sanitize(config.value);
  const b = basis ?? emptyBasis();

  switch (config.mode) {
    case "fixed": {
      const amount = round2(value);
      return { mode: "fixed", value, amount, applicable: true, formula: `Supplément fixe : ${amount} €` };
    }
    case "per_km": {
      if (!b.kmApplicable || b.billableKm <= 0) {
        return {
          mode: "per_km",
          value,
          amount: 0,
          applicable: false,
          formula: "Supplément au km : 0 € (aucun kilomètre facturable)",
          note: "Cette prestation n'a pas de composante kilométrique : le supplément au kilomètre ne s'applique pas.",
        };
      }
      const km = round2(b.billableKm);
      const amount = ceilEuro(km * value);
      return {
        mode: "per_km",
        value,
        amount,
        applicable: true,
        formula: `${km} km facturables × ${value} €/km = ${amount} €`,
      };
    }
    case "percent_km": {
      if (!b.kmApplicable || b.kmAmount <= 0) {
        return {
          mode: "percent_km",
          value,
          amount: 0,
          applicable: false,
          formula: "Majoration kilométrique : 0 € (aucune composante kilométrique)",
          note: "Cette prestation n'a pas de composante kilométrique : la majoration en pourcentage ne s'applique pas.",
        };
      }
      const amount = ceilEuro((b.kmAmount * value) / 100);
      return {
        mode: "percent_km",
        value,
        amount,
        applicable: true,
        formula: `${value} % × composante kilométrique ${round2(b.kmAmount)} € = ${amount} €`,
      };
    }
    default:
      return { mode: "none", value: 0, amount: 0, applicable: true, formula: "Aucun supplément" };
  }
}

/** Phrase d'aide affichée dans le formulaire véhicule / le calculateur (sans calcul). */
export function describeSurcharge(config: VehiclePricingConfig): string {
  const v = sanitize(config.value);
  const fmt = (n: number) => String(n).replace(".", ",");
  switch (config.mode) {
    case "fixed":
      return `Ce véhicule ajoute ${fmt(v)} € au tarif calculé.`;
    case "per_km":
      return `Ce véhicule ajoute ${fmt(v)} € pour chaque kilomètre facturable.`;
    case "percent_km":
      return `Ce véhicule augmente de ${fmt(v)} % la composante kilométrique du tarif.`;
    default:
      return "Ce véhicule est au tarif standard (aucun supplément).";
  }
}
