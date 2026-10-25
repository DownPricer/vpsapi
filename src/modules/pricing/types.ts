import type { DateTime } from "luxon";
import type { VehicleSurchargeBasis } from "./vehicleSurcharge";

export interface DistanceResult {
  km: number;
  duree: number;
}

export interface Distances {
  aller: {
    approche: Partial<DistanceResult>;
    trajet: Partial<DistanceResult>;
    retourBase: Partial<DistanceResult>;
  };
  retour: {
    approche: Partial<DistanceResult>;
    trajet: Partial<DistanceResult>;
    retourBase: Partial<DistanceResult>;
  };
}

export interface CreneauResult {
  creneauGlobal: {
    DateDebut: string;
    HeureDebut: string;
    DateFin: string;
    HeureFin: string;
    startISO: string;
    endISO: string;
  };
  creneauxDouble: {
    aller: {
      DateDebut: string;
      HeureDebut: string;
      DateFin: string;
      HeureFin: string;
      startISO: string;
      endISO: string;
    };
    retour: {
      DateDebut: string;
      HeureDebut: string;
      DateFin: string;
      HeureFin: string;
      startISO: string;
      endISO: string;
    };
  };
  googleCreneaux: Array<{ start: string; end: string }>;
  classicPickupRetour: DateTime | null;
  pickupAller: DateTime | null;
  pickupRetour: DateTime | null;
}

export type TarifResult = {
  tarif: number;
  distances: Distances;
  tarifs: Record<string, unknown>;
  majorations: Array<{ leg: string; montant: number }>;
  /** Assiette du supplément véhicule, issue du même calcul que `tarif` (voir vehicleSurcharge.ts). */
  vehicleBasis?: VehicleSurchargeBasis;
  /** Tarif métier avant supplément véhicule (renseigné quand un véhicule est appliqué). */
  tarifBase?: number;
  /** Supplément et snapshot du véhicule appliqué (renseigné par applyVehicleToResult). */
  vehicle?: import("./vehicleSurchargeApply").AppliedVehicleSnapshot;
} & CreneauResult;
