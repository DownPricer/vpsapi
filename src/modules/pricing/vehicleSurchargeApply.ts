import {
  computeVehicleSurcharge,
  round2,
  type VehicleSurchargeBasis,
  type VehicleSurchargeMode,
  type VehicleSurchargeResult,
} from "./vehicleSurcharge";
import type { TarifResult } from "./types";

/** Champs du véhicule nécessaires au tarif et copiés dans le snapshot (aucune donnée interne : ni immatriculation, ni référence interne). */
export interface VehicleForPricing {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  passengerMax: number;
  luggageLabel?: string | null;
  photoUrl?: string | null;
  surchargeMode: VehicleSurchargeMode;
  surchargeValue: number;
}

export interface AppliedVehicleSnapshot {
  vehicleId: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  passengerMax: number;
  luggageLabel: string | null;
  photoUrl: string | null;
  surcharge: VehicleSurchargeResult;
  /** Tarif métier avant supplément. */
  tarifBase: number;
  /** Tarif final communiqué au client (= tarifBase + surcharge.amount). */
  tarifTotal: number;
  /** Assiette utilisée (permet de recalculer un changement de véhicule sans rappeler le service de distance). */
  basis: VehicleSurchargeBasis | null;
  snapshotAt: string;
}

export function buildVehicleSnapshot(
  vehicle: VehicleForPricing,
  tarifBase: number,
  basis: VehicleSurchargeBasis | null | undefined,
  now: Date = new Date()
): AppliedVehicleSnapshot {
  const surcharge = computeVehicleSurcharge({ mode: vehicle.surchargeMode, value: vehicle.surchargeValue }, basis);
  return {
    vehicleId: vehicle.id,
    name: vehicle.name,
    brand: vehicle.brand ?? null,
    model: vehicle.model ?? null,
    category: vehicle.category ?? null,
    passengerMax: vehicle.passengerMax,
    luggageLabel: vehicle.luggageLabel ?? null,
    photoUrl: vehicle.photoUrl ?? null,
    surcharge,
    tarifBase,
    tarifTotal: round2(tarifBase + surcharge.amount),
    basis: basis ?? null,
    snapshotAt: now.toISOString(),
  };
}

/**
 * Ajoute le supplément du véhicule au résultat du moteur (mutation) : `tarif` devient le total final,
 * `tarifBase` conserve le tarif métier. C'est `tarif` que lisent déjà Stripe, les e-mails et le dashboard.
 */
export function applyVehicleToResult(result: TarifResult, vehicle: VehicleForPricing): AppliedVehicleSnapshot {
  const base = result.tarif;
  const snapshot = buildVehicleSnapshot(vehicle, base, result.vehicleBasis);
  result.tarifBase = base;
  result.tarif = snapshot.tarifTotal;
  result.tarifs = {
    ...result.tarifs,
    totalBase: base,
    vehicleSurcharge: snapshot.surcharge.amount,
    total: snapshot.tarifTotal,
  };
  result.vehicle = snapshot;
  return snapshot;
}
