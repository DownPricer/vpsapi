import type { TarifResult } from "./types";

/** Sérialisation JSON (Luxon DateTime → ISO). */
export function serializeTarifResult(result: TarifResult): Record<string, unknown> {
  return {
    tarif: result.tarif,
    distances: result.distances,
    tarifs: result.tarifs,
    majorations: result.majorations,
    tarifBase: result.tarifBase ?? result.tarif,
    vehicle: result.vehicle ?? null,
    vehicleBasis: result.vehicleBasis ?? null,
    creneauGlobal: result.creneauGlobal,
    creneauxDouble: result.creneauxDouble,
    googleCreneaux: result.googleCreneaux,
    classicPickupRetour: result.classicPickupRetour?.toISO() ?? null,
    pickupAller: result.pickupAller?.toISO() ?? null,
    pickupRetour: result.pickupRetour?.toISO() ?? null,
  };
}
