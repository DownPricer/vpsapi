import type { DateTime } from "luxon";

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
} & CreneauResult;
