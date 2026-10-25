import { LeadStatus, Prisma, VehicleBlockReason } from "@prisma/client";
import type { LeadRequest, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getTenantConfig } from "../config/tenants/registry";
import {
  DEFAULT_TENANT_TIMEZONE,
  dateToDayKey,
  dayKeyToDate,
  eachDayKey,
  isValidDayKey,
  localDaysBetween,
} from "../modules/fleet/days";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Statuts qui OCCUPENT le véhicule (un véhicule = une seule réservation active par jour civil) :
 *  - accepted / scheduled : course confirmée par le chauffeur ;
 *  - completed            : course effectuée (le jour reste occupé dans l'historique du calendrier) ;
 *  - cancellation_requested : le client a DEMANDÉ l'annulation mais le chauffeur ne l'a pas confirmée → la course reste active.
 * Ne bloquent PAS : new, pending (devis/demande simplement reçue), processed (« traité » = dossier suivi, pas confirmé),
 * refused, archived, expired, cancelled (annulation confirmée → véhicule libéré, historique conservé).
 */
export const BLOCKING_LEAD_STATUSES: readonly LeadStatus[] = [
  LeadStatus.accepted,
  LeadStatus.scheduled,
  LeadStatus.completed,
  LeadStatus.cancellation_requested,
];

export function isBlockingStatus(status: LeadStatus): boolean {
  return BLOCKING_LEAD_STATUSES.includes(status);
}

export type ConflictDetail = { day: string; kind: "booking" | "block"; leadId?: string | null; blockId?: string | null };

export class VehicleUnavailableError extends Error {
  readonly code = "VEHICLE_UNAVAILABLE";
  readonly status = 409;
  constructor(
    public readonly vehicleName: string | null,
    public readonly conflicts: ConflictDetail[],
    message?: string
  ) {
    super(
      message ??
        "Ce véhicule est déjà réservé pour cette date. Choisissez un autre véhicule ou proposez une autre date."
    );
    this.name = "VehicleUnavailableError";
  }
}

export class VehicleScheduleMissingError extends Error {
  readonly code = "VEHICLE_SCHEDULE_MISSING";
  readonly status = 422;
  constructor() {
    super("La date de la course est introuvable : impossible de bloquer le véhicule. Renseignez la date avant de confirmer.");
    this.name = "VehicleScheduleMissingError";
  }
}

export function tenantTimezone(tenantId: string): string {
  return getTenantConfig(tenantId)?.pricingEngine?.timezone ?? DEFAULT_TENANT_TIMEZONE;
}

export function leadOccupationDays(
  lead: Pick<LeadRequest, "scheduledStart" | "scheduledEnd" | "tenantId">
): string[] {
  if (!lead.scheduledStart) return [];
  return localDaysBetween(lead.scheduledStart, lead.scheduledEnd, tenantTimezone(lead.tenantId));
}

async function findConflicts(
  db: Db,
  vehicleId: string,
  days: string[],
  ignoreLeadId?: string | null
): Promise<ConflictDetail[]> {
  if (days.length === 0) return [];
  const rows = await db.vehicleDayOccupation.findMany({
    where: {
      vehicleId,
      day: { in: days.map(dayKeyToDate) },
      ...(ignoreLeadId ? { NOT: { leadId: ignoreLeadId } } : {}),
    },
    select: { day: true, leadId: true, blockId: true },
    orderBy: { day: "asc" },
  });
  return rows.map((r) => ({
    day: dateToDayKey(r.day),
    kind: r.blockId ? ("block" as const) : ("booking" as const),
    leadId: r.leadId,
    blockId: r.blockId,
  }));
}

/** Contrôle informatif (création de devis, calculateur) : ne réserve rien. */
export async function assertVehicleFree(
  db: Db,
  params: { tenantId: string; vehicleId: string; days: string[]; vehicleName?: string | null; ignoreLeadId?: string | null }
): Promise<void> {
  const conflicts = await findConflicts(db, params.vehicleId, params.days, params.ignoreLeadId);
  if (conflicts.length > 0) {
    throw new VehicleUnavailableError(
      params.vehicleName ?? null,
      conflicts,
      conflicts.every((c) => c.kind === "block") ? "Ce véhicule est indisponible à cette date." : undefined
    );
  }
}

/**
 * Synchronise les occupations d'une demande avec son état (statut, véhicule, dates). Idempotent.
 * À appeler DANS la transaction qui modifie le statut/véhicule/dates.
 * La contrainte UNIQUE (vehicleId, day) en base est le dernier rempart contre les acceptations concurrentes :
 * la seconde transaction attend la première, puis échoue → VehicleUnavailableError.
 */
export async function syncLeadOccupation(tx: Prisma.TransactionClient, leadId: string): Promise<void> {
  const lead = await tx.leadRequest.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      vehicleId: true,
      scheduledStart: true,
      scheduledEnd: true,
      vehicle: { select: { name: true } },
    },
  });
  if (!lead) return;

  const wanted =
    lead.vehicleId && isBlockingStatus(lead.status) ? leadOccupationDays(lead) : ([] as string[]);

  if (lead.vehicleId && isBlockingStatus(lead.status) && !lead.scheduledStart) {
    throw new VehicleScheduleMissingError();
  }

  const existing = await tx.vehicleDayOccupation.findMany({
    where: { leadId: lead.id },
    select: { id: true, vehicleId: true, day: true },
  });
  const keep = new Set<string>();
  const toDelete: string[] = [];
  for (const e of existing) {
    const key = dateToDayKey(e.day);
    if (lead.vehicleId && e.vehicleId === lead.vehicleId && wanted.includes(key)) keep.add(key);
    else toDelete.push(e.id);
  }
  if (toDelete.length > 0) {
    await tx.vehicleDayOccupation.deleteMany({ where: { id: { in: toDelete } } });
  }

  const toCreate = wanted.filter((d) => !keep.has(d));
  if (toCreate.length === 0 || !lead.vehicleId) return;

  const conflicts = await findConflicts(tx, lead.vehicleId, toCreate, lead.id);
  if (conflicts.length > 0) {
    throw new VehicleUnavailableError(
      lead.vehicle?.name ?? null,
      conflicts,
      conflicts.every((c) => c.kind === "block") ? "Ce véhicule est indisponible à cette date." : undefined
    );
  }
  try {
    await tx.vehicleDayOccupation.createMany({
      data: toCreate.map((d) => ({
        tenantId: lead.tenantId,
        vehicleId: lead.vehicleId!,
        day: dayKeyToDate(d),
        leadId: lead.id,
      })),
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new VehicleUnavailableError(lead.vehicle?.name ?? null, toCreate.map((day) => ({ day, kind: "booking" as const })));
    }
    throw e;
  }
}

/** Jours occupés (réservations + blocages) par véhicule sur une liste de jours : sert au calculateur public. */
export async function getOccupiedVehicleIds(
  tenantId: string,
  vehicleIds: string[],
  days: string[],
  db: Db = prisma
): Promise<Map<string, ConflictDetail[]>> {
  const out = new Map<string, ConflictDetail[]>();
  if (vehicleIds.length === 0 || days.length === 0) return out;
  const rows = await db.vehicleDayOccupation.findMany({
    where: { tenantId, vehicleId: { in: vehicleIds }, day: { in: days.map(dayKeyToDate) } },
    select: { vehicleId: true, day: true, leadId: true, blockId: true },
  });
  for (const r of rows) {
    const list = out.get(r.vehicleId) ?? [];
    list.push({ day: dateToDayKey(r.day), kind: r.blockId ? "block" : "booking", leadId: r.leadId, blockId: r.blockId });
    out.set(r.vehicleId, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blocages manuels (entretien, congés…)
// ---------------------------------------------------------------------------

export async function createVehicleBlock(input: {
  tenantId: string;
  vehicleId: string;
  startDay: string;
  endDay: string;
  reason: VehicleBlockReason;
  note?: string | null;
}) {
  if (!isValidDayKey(input.startDay) || !isValidDayKey(input.endDay) || input.endDay < input.startDay) {
    throw Object.assign(new Error("Période invalide."), { status: 400, code: "VALIDATION_ERROR" });
  }
  const days = eachDayKey(input.startDay, input.endDay);
  if (days.length > 366) {
    throw Object.assign(new Error("Période trop longue (366 jours maximum)."), { status: 400, code: "VALIDATION_ERROR" });
  }
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, tenantId: input.tenantId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!vehicle) throw Object.assign(new Error("Véhicule introuvable."), { status: 404, code: "NOT_FOUND" });

    const conflicts = await findConflicts(tx, vehicle.id, days);
    if (conflicts.length > 0) {
      throw new VehicleUnavailableError(
        vehicle.name,
        conflicts,
        "Impossible de bloquer cette période : le véhicule est déjà réservé ou bloqué à certaines dates."
      );
    }
    const block = await tx.vehicleBlock.create({
      data: {
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
        startDay: dayKeyToDate(input.startDay),
        endDay: dayKeyToDate(input.endDay),
        reason: input.reason,
        note: input.note?.slice(0, 500) || null,
      },
    });
    try {
      await tx.vehicleDayOccupation.createMany({
        data: days.map((d) => ({ tenantId: input.tenantId, vehicleId: vehicle.id, day: dayKeyToDate(d), blockId: block.id })),
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new VehicleUnavailableError(vehicle.name, days.map((day) => ({ day, kind: "booking" as const })));
      }
      throw e;
    }
    return block;
  });
}

export async function deleteVehicleBlock(tenantId: string, blockId: string): Promise<boolean> {
  const res = await prisma.vehicleBlock.deleteMany({ where: { id: blockId, tenantId } });
  return res.count > 0;
}

export async function listVehicleBlocks(tenantId: string, vehicleId?: string) {
  return prisma.vehicleBlock.findMany({
    where: { tenantId, ...(vehicleId ? { vehicleId } : {}) },
    orderBy: { startDay: "asc" },
  });
}

/** Occupations du calendrier pro (réservations + blocages) entre deux jours civils inclus. */
export async function listOccupations(tenantId: string, fromDay: string, toDay: string, vehicleId?: string) {
  return prisma.vehicleDayOccupation.findMany({
    where: {
      tenantId,
      day: { gte: dayKeyToDate(fromDay), lte: dayKeyToDate(toDay) },
      ...(vehicleId ? { vehicleId } : {}),
    },
    orderBy: [{ day: "asc" }],
    select: {
      id: true,
      vehicleId: true,
      day: true,
      leadId: true,
      blockId: true,
      block: { select: { reason: true, note: true, startDay: true, endDay: true } },
    },
  });
}
