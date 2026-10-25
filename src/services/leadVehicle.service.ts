import { LeadKind, LeadStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { buildVehicleSnapshot, type AppliedVehicleSnapshot } from "../modules/pricing/vehicleSurchargeApply";
import type { VehicleSurchargeBasis } from "../modules/pricing/vehicleSurcharge";
import { COLLECTED_PAYMENT_STATUSES } from "./paymentStatuses";
import { extractGroupSize, VehicleError, VehicleSelectionError } from "./vehicle.service";
import { syncLeadOccupation, tenantTimezone, leadOccupationDays } from "./vehicleAvailability.service";

/** Un paiement ouvert (lien envoyé / en attente) ou encaissé fige le prix : on ne le réécrit jamais silencieusement. */
const PRICE_LOCKING_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.LINK_SENT,
  ...COLLECTED_PAYMENT_STATUSES,
];

const EDITABLE_STATUSES: LeadStatus[] = [
  LeadStatus.new,
  LeadStatus.pending,
  LeadStatus.processed,
  LeadStatus.accepted,
  LeadStatus.scheduled,
];

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function readBasis(pricingResult: Record<string, unknown>): VehicleSurchargeBasis | null {
  const direct = asRecord(pricingResult.vehicleBasis);
  const fromSnap = asRecord(asRecord(pricingResult.vehicle).basis);
  const b = Object.keys(direct).length ? direct : fromSnap;
  if (!Object.keys(b).length) return null;
  return {
    kmApplicable: b.kmApplicable === true,
    billableKm: Number(b.billableKm) || 0,
    kmAmount: Number(b.kmAmount) || 0,
  };
}

export type ChangeVehicleResult = {
  leadId: string;
  vehicleId: string | null;
  priceBefore: number;
  priceAfter: number;
  snapshot: AppliedVehicleSnapshot | null;
};

/**
 * Change (ou attribue) le véhicule d'une demande/réservation, de façon atomique :
 *  1. le nouveau véhicule doit appartenir au tenant, être actif et accepter le groupe ;
 *  2. le supplément est RECALCULÉ CÔTÉ SERVEUR à partir de l'assiette conservée dans le snapshot du devis
 *     (aucun nouvel appel au service de distance, aucun prix fourni par le navigateur) ;
 *  3. si un paiement est ouvert ou encaissé et que le prix changerait → refus (PRICE_LOCKED) ;
 *  4. l'ancien véhicule n'est libéré que si la prise du nouveau réussit (même transaction + contrainte d'unicité).
 */
export async function changeLeadVehicle(input: {
  tenantId: string;
  leadId: string;
  vehicleId: string | null;
  actorUserId?: string | null;
  note?: string | null;
}): Promise<ChangeVehicleResult> {
  return prisma.$transaction(async (tx) => {
    // Verrou de ligne : deux modifications simultanées de la même demande sont sérialisées.
    await tx.$queryRaw`SELECT id FROM "LeadRequest" WHERE id = ${input.leadId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
    const lead = await tx.leadRequest.findFirst({ where: { id: input.leadId, tenantId: input.tenantId } });
    if (!lead) throw new VehicleError("Demande introuvable.", "NOT_FOUND", 404);
    if (lead.kind === LeadKind.contact) throw new VehicleError("Une demande de contact n'a pas de véhicule.", "NOT_APPLICABLE", 409);
    if (!EDITABLE_STATUSES.includes(lead.status)) {
      throw new VehicleError("Cette demande n'est plus modifiable (annulée, refusée, terminée ou en cours d'annulation).", "NOT_EDITABLE", 409);
    }

    const pr = asRecord(lead.pricingResult);
    const priceBefore = Number(pr.tarif) || 0;
    const baseTarif = Number(pr.tarifBase ?? pr.tarif) || 0;
    const basis = readBasis(pr);

    let snapshot: AppliedVehicleSnapshot | null = null;
    let fromSnapshot = lead.vehicleSnapshot;
    if (input.vehicleId) {
      const v = await tx.vehicle.findFirst({
        where: { id: input.vehicleId, tenantId: input.tenantId },
        include: { photos: { orderBy: { position: "asc" }, take: 1 } },
      });
      if (!v) throw new VehicleSelectionError("Véhicule introuvable.", "VEHICLE_NOT_FOUND", 404);
      if (!v.active || v.archivedAt) throw new VehicleSelectionError("Ce véhicule n'est plus proposé.", "VEHICLE_INACTIVE", 409);

      const { passengers, bags } = extractGroupSize(asRecord(lead.rawPayload));
      if (passengers > v.passengerMax) {
        throw new VehicleSelectionError(`${v.name} accueille ${v.passengerMax} passager(s) maximum.`, "VEHICLE_CAPACITY", 422);
      }
      if (v.largeBags != null && bags > v.largeBags) {
        throw new VehicleSelectionError(`${v.name} accepte ${v.largeBags} gros bagage(s) maximum.`, "VEHICLE_CAPACITY", 422);
      }
      if ((v.surchargeMode === "per_km" || v.surchargeMode === "percent_km") && !basis) {
        throw new VehicleError(
          "Cette réservation ancienne n'a pas de détail kilométrique : choisissez un véhicule sans supplément kilométrique.",
          "NO_PRICING_BASIS",
          422
        );
      }
      snapshot = buildVehicleSnapshot(
        {
          id: v.id,
          name: v.name,
          brand: v.brand,
          model: v.model,
          category: v.category,
          passengerMax: v.passengerMax,
          luggageLabel: v.luggageLabel,
          photoUrl: v.photos[0]?.url ?? null,
          surchargeMode: v.surchargeMode,
          surchargeValue: v.surchargeValue.toNumber(),
        },
        baseTarif,
        basis
      );
    }

    const priceAfter = snapshot ? snapshot.tarifTotal : baseTarif;
    if (Math.abs(priceAfter - priceBefore) > 0.004) {
      const locking = await tx.payment.count({
        where: { leadRequestId: lead.id, tenantId: lead.tenantId, status: { in: PRICE_LOCKING_PAYMENT_STATUSES } },
      });
      if (locking > 0) {
        throw new VehicleError(
          `Ce changement modifierait le prix (${priceBefore} € → ${priceAfter} €) alors qu'un paiement est en cours ou encaissé. Annulez le lien de paiement ou traitez un remboursement avant de changer de véhicule.`,
          "PRICE_LOCKED",
          409
        );
      }
    }

    const flat = { ...asRecord(lead.flatPayload) } as Record<string, unknown>;
    delete flat.VehiculeId;
    delete flat.Vehicule;
    delete flat.TarifBase;
    delete flat.SupplementVehicule;
    delete flat.TarifTrajet;
    if (snapshot) {
      flat.VehiculeId = snapshot.vehicleId;
      flat.Vehicule = snapshot.name;
      flat.TarifBase = snapshot.tarifBase.toFixed(2);
      flat.SupplementVehicule = snapshot.surcharge.amount.toFixed(2);
      if (snapshot.surcharge.amount > 0) flat.TarifTrajet = snapshot.tarifBase.toFixed(2);
    }
    flat.TarifTotal = priceAfter.toFixed(2);

    const newPricing: Record<string, unknown> = { ...pr, tarif: priceAfter, tarifBase: baseTarif };
    if (snapshot) newPricing.vehicle = snapshot;
    else delete newPricing.vehicle;
    newPricing.tarifs = { ...asRecord(pr.tarifs), total: priceAfter, totalBase: baseTarif, vehicleSurcharge: snapshot?.surcharge.amount ?? 0 };

    await tx.leadRequest.update({
      where: { id: lead.id },
      data: {
        vehicleId: input.vehicleId,
        vehicleSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        pricingResult: newPricing as Prisma.InputJsonValue,
        flatPayload: flat as Prisma.InputJsonValue,
      },
    });

    // Prend le nouveau véhicule (conflit → exception → TOUT est annulé, l'ancien reste attribué) puis libère l'ancien.
    await syncLeadOccupation(tx, lead.id);

    await tx.leadVehicleChange.create({
      data: {
        tenantId: lead.tenantId,
        leadId: lead.id,
        fromVehicleId: lead.vehicleId,
        toVehicleId: input.vehicleId,
        fromSnapshot: fromSnapshot == null ? Prisma.DbNull : (fromSnapshot as Prisma.InputJsonValue),
        toSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        priceBefore: new Prisma.Decimal(priceBefore),
        priceAfter: new Prisma.Decimal(priceAfter),
        changedByUserId: input.actorUserId ?? null,
        note: input.note?.slice(0, 500) ?? null,
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId: lead.tenantId,
        previousStatus: lead.status,
        newStatus: lead.status,
        changedByUserId: input.actorUserId ?? null,
        note: `Véhicule : ${(fromSnapshot as { name?: string } | null)?.name ?? "aucun"} → ${snapshot?.name ?? "aucun"}${
          priceAfter !== priceBefore ? ` (prix ${priceBefore} € → ${priceAfter} €)` : ""
        }`,
      },
    });

    return { leadId: lead.id, vehicleId: input.vehicleId, priceBefore, priceAfter, snapshot };
  });
}

/**
 * Déplace une course. Le prix n'est PAS recalculé (aucune nouvelle tarification n'est faite ici) ; si la demande occupe
 * un véhicule, les nouveaux jours sont réservés atomiquement et les anciens libérés (conflit → rien ne change).
 */
export async function rescheduleLead(input: {
  tenantId: string;
  leadId: string;
  scheduledStart: Date;
  scheduledEnd?: Date | null;
  actorUserId?: string | null;
}) {
  const end = input.scheduledEnd ?? new Date(input.scheduledStart.getTime() + 90 * 60 * 1000);
  if (!(end.getTime() >= input.scheduledStart.getTime())) {
    throw new VehicleError("La fin de la course doit suivre son début.", "VALIDATION_ERROR", 400);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LeadRequest" WHERE id = ${input.leadId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
    const lead = await tx.leadRequest.findFirst({ where: { id: input.leadId, tenantId: input.tenantId } });
    if (!lead) throw new VehicleError("Demande introuvable.", "NOT_FOUND", 404);
    if (!EDITABLE_STATUSES.includes(lead.status)) {
      throw new VehicleError("Cette demande n'est plus modifiable.", "NOT_EDITABLE", 409);
    }
    const updated = await tx.leadRequest.update({
      where: { id: lead.id },
      data: { scheduledStart: input.scheduledStart, scheduledEnd: end },
    });
    await syncLeadOccupation(tx, lead.id);
    await tx.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId: lead.tenantId,
        previousStatus: lead.status,
        newStatus: lead.status,
        changedByUserId: input.actorUserId ?? null,
        note: `Date modifiée : ${leadOccupationDays({ tenantId: lead.tenantId, scheduledStart: input.scheduledStart, scheduledEnd: end }).join(" → ")}`,
      },
    });
    return updated;
  });
}

export { tenantTimezone };
