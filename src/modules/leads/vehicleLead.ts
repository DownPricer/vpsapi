import type { Prisma } from "@prisma/client";
import type { AppliedVehicleSnapshot } from "../pricing/vehicleSurchargeApply";

/**
 * Champs « à plat » ajoutés au flatPayload (lu par les e-mails, le dashboard, les PDF).
 * `TarifTotal` est déjà le total final (le moteur y met `result.tarif`, supplément inclus).
 */
export function vehicleFlatFields(v: AppliedVehicleSnapshot | null): Record<string, string> {
  if (!v) return {};
  const fields: Record<string, string> = {
    VehiculeId: v.vehicleId,
    Vehicule: v.name,
    TarifBase: v.tarifBase.toFixed(2),
    SupplementVehicule: v.surcharge.amount.toFixed(2),
  };
  if (v.surcharge.amount > 0) fields.TarifTrajet = v.tarifBase.toFixed(2);
  return fields;
}

/** « Mercedes Classe V » (figé dans le flatPayload à la création) : libellé du véhicule pour les e-mails, ou chaîne vide. */
export function vehicleLabelFromFlat(flat: Record<string, unknown> | null | undefined): string {
  const v = flat?.Vehicule;
  return typeof v === "string" && v.trim() && v.trim().toUpperCase() !== "N/A" ? v.trim() : "";
}

export function vehicleLeadColumns(v: AppliedVehicleSnapshot | null): {
  vehicleId?: string;
  vehicleSnapshot?: Prisma.InputJsonValue;
} {
  if (!v) return {};
  return { vehicleId: v.vehicleId, vehicleSnapshot: v as unknown as Prisma.InputJsonValue };
}
