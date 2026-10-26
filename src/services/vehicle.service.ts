import { Prisma } from "@prisma/client";
import type { Vehicle, VehiclePhoto, VehicleSurchargeMode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { dateToDayKey, dayKeyToDate } from "../modules/fleet/days";
import { deleteStoredPhoto, storeVehiclePhoto } from "../modules/fleet/photoStorage";
import { describeSurcharge } from "../modules/pricing/vehicleSurcharge";
import type { VehicleForPricing } from "../modules/pricing/vehicleSurchargeApply";
import { tenantTimezone } from "./vehicleAvailability.service";
import { DateTime } from "luxon";

export const MAX_VEHICLE_PHOTOS = 5;

export class VehicleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "VehicleError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const stringList = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().min(1).max(maxLen))
    .max(maxItems)
    .transform((a) => [...new Set(a)]);

const surchargeModeSchema = z.enum(["none", "fixed", "per_km", "percent_km"]);

export const vehicleWriteSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est obligatoire.").max(80),
    brand: optText(60),
    model: optText(60),
    trim: optText(60),
    year: z.number().int().min(1950).max(2100).nullish(),
    vehicleType: optText(40),
    category: optText(40),
    shortDescription: z.string().trim().max(160).default(""),
    description: optText(2000),
    active: z.boolean(),
    passengerMax: z.number().int().min(1).max(99),
    luggageLabel: optText(80),
    largeBags: z.number().int().min(0).max(50).nullish(),
    airConditioning: z.boolean(),
    wifi: z.boolean(),
    usbChargers: z.boolean(),
    babySeats: z.boolean(),
    accessible: z.boolean(),
    features: stringList(20, 60),
    paymentChips: stringList(10, 30),
    internalRef: optText(60),
    licensePlate: optText(20),
    surchargeMode: surchargeModeSchema,
    surchargeValue: z.number().finite().min(0).max(100_000),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (v.surchargeMode === "percent_km" && (v.surchargeValue ?? 0) > 100) {
      ctx.addIssue({ code: "custom", path: ["surchargeValue"], message: "Le pourcentage doit être compris entre 0 et 100." });
    }
    if (v.surchargeMode && v.surchargeMode !== "none" && v.surchargeValue === undefined) {
      ctx.addIssue({ code: "custom", path: ["surchargeValue"], message: "Indiquez le montant du supplément." });
    }
  });

export type VehicleWriteInput = z.infer<typeof vehicleWriteSchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

type VehicleRow = Vehicle & { photos: VehiclePhoto[] };

const num = (d: Prisma.Decimal | number): number => (typeof d === "number" ? d : d.toNumber());

export function surchargeLabel(mode: VehicleSurchargeMode, value: number): string {
  const fmt = (n: number) => String(n).replace(".", ",");
  if (mode === "fixed") return `+${fmt(value)} € sur votre trajet`;
  if (mode === "per_km") return `+${fmt(value)} €/km`;
  if (mode === "percent_km") return `+${fmt(value)} % sur la partie kilométrique`;
  return "Tarif standard";
}

export function toProVehicle(v: VehicleRow) {
  const value = num(v.surchargeValue);
  const photos = [...v.photos].sort((a, b) => a.position - b.position);
  return {
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    trim: v.trim,
    year: v.year,
    vehicleType: v.vehicleType,
    category: v.category,
    shortDescription: v.shortDescription,
    description: v.description,
    active: v.active,
    archived: v.archivedAt != null,
    featured: v.featured,
    sortOrder: v.sortOrder,
    passengerMax: v.passengerMax,
    luggageLabel: v.luggageLabel,
    largeBags: v.largeBags,
    airConditioning: v.airConditioning,
    wifi: v.wifi,
    usbChargers: v.usbChargers,
    babySeats: v.babySeats,
    accessible: v.accessible,
    features: v.features,
    paymentChips: v.paymentChips,
    internalRef: v.internalRef,
    licensePlate: v.licensePlate,
    surchargeMode: v.surchargeMode,
    surchargeValue: value,
    surchargeDescription: describeSurcharge({ mode: v.surchargeMode, value }),
    photos: photos.map((p) => ({ id: p.id, url: p.url, alt: p.alt, position: p.position })),
    photoCount: photos.length,
    maxPhotos: MAX_VEHICLE_PHOTOS,
  };
}

/** Vue publique : AUCUNE donnée interne (immatriculation, référence interne), ni archivés/inactifs. */
export function toPublicVehicle(v: VehicleRow) {
  const value = num(v.surchargeValue);
  const photos = [...v.photos].sort((a, b) => a.position - b.position);
  return {
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    trim: v.trim,
    year: v.year,
    vehicleType: v.vehicleType,
    category: v.category,
    shortDescription: v.shortDescription,
    description: v.description,
    featured: v.featured,
    passengerMax: v.passengerMax,
    luggageLabel: v.luggageLabel,
    largeBags: v.largeBags,
    airConditioning: v.airConditioning,
    wifi: v.wifi,
    usbChargers: v.usbChargers,
    babySeats: v.babySeats,
    accessible: v.accessible,
    features: v.features,
    paymentChips: v.paymentChips,
    surcharge: { mode: v.surchargeMode, value, label: surchargeLabel(v.surchargeMode, value) },
    photos: photos.map((p) => ({ src: p.url, alt: p.alt || v.name })),
  };
}

export type ProVehicle = ReturnType<typeof toProVehicle>;
export type PublicVehicle = ReturnType<typeof toPublicVehicle>;

const include = { photos: { orderBy: { position: "asc" as const } } };

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listProVehicles(tenantId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await prisma.vehicle.findMany({
    where: { tenantId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    include,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toProVehicle);
}

export async function getProVehicle(tenantId: string, id: string) {
  const row = await prisma.vehicle.findFirst({ where: { id, tenantId }, include });
  return row ? toProVehicle(row) : null;
}

export async function listPublicVehicles(tenantId: string) {
  const rows = await prisma.vehicle.findMany({
    where: { tenantId, active: true, archivedAt: null },
    include,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPublicVehicle);
}

export async function countSelectableVehicles(tenantId: string): Promise<number> {
  return prisma.vehicle.count({ where: { tenantId, active: true, archivedAt: null } });
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

function toData(input: VehicleWriteInput): Prisma.VehicleUncheckedUpdateInput {
  const data: Prisma.VehicleUncheckedUpdateInput = {};
  const set = <K extends keyof VehicleWriteInput>(k: K, map?: (v: NonNullable<VehicleWriteInput[K]>) => unknown) => {
    if (input[k] === undefined) return;
    (data as Record<string, unknown>)[k as string] = input[k] === null ? null : map ? map(input[k] as NonNullable<VehicleWriteInput[K]>) : input[k];
  };
  set("name");
  set("brand");
  set("model");
  set("trim");
  set("year");
  set("vehicleType");
  set("category");
  set("shortDescription");
  set("description");
  set("active");
  set("passengerMax");
  set("luggageLabel");
  set("largeBags");
  set("airConditioning");
  set("wifi");
  set("usbChargers");
  set("babySeats");
  set("accessible");
  set("features");
  set("paymentChips");
  set("internalRef");
  set("licensePlate");
  if (input.surchargeMode !== undefined) {
    data.surchargeMode = input.surchargeMode;
    if (input.surchargeMode === "none") data.surchargeValue = new Prisma.Decimal(0);
  }
  if (input.surchargeValue !== undefined && input.surchargeMode !== "none") {
    data.surchargeValue = new Prisma.Decimal(input.surchargeValue);
  }
  return data;
}

async function ensureFeaturedExists(tx: Prisma.TransactionClient, tenantId: string) {
  const current = await tx.vehicle.findFirst({
    where: { tenantId, featured: true, active: true, archivedAt: null },
    select: { id: true },
  });
  if (current) return;
  await tx.vehicle.updateMany({ where: { tenantId, featured: true }, data: { featured: false } });
  const next = await tx.vehicle.findFirst({
    where: { tenantId, active: true, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (next) await tx.vehicle.update({ where: { id: next.id }, data: { featured: true } });
}

export async function createVehicle(tenantId: string, input: VehicleWriteInput) {
  const parsedName = input.name?.trim();
  if (!parsedName) throw new VehicleError("Le nom est obligatoire.", "VALIDATION_ERROR");
  return prisma.$transaction(async (tx) => {
    const last = await tx.vehicle.aggregate({ where: { tenantId }, _max: { sortOrder: true } });
    const created = await tx.vehicle.create({
      data: {
        ...(toData({ ...input, name: undefined }) as Prisma.VehicleUncheckedCreateInput),
        tenantId,
        name: parsedName,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    await ensureFeaturedExists(tx, tenantId);
    const row = await tx.vehicle.findUniqueOrThrow({ where: { id: created.id }, include });
    return toProVehicle(row);
  });
}

export async function updateVehicle(tenantId: string, id: string, input: VehicleWriteInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findFirst({ where: { id, tenantId } });
    if (!existing) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
    if (existing.archivedAt && input.active === true) {
      throw new VehicleError("Ce véhicule est archivé : restaurez-le d'abord.", "ARCHIVED", 409);
    }
    await tx.vehicle.update({ where: { id }, data: toData(input) });
    if (input.active === false) {
      await tx.vehicle.update({ where: { id }, data: { featured: false } });
    }
    await ensureFeaturedExists(tx, tenantId);
    return toProVehicle(await tx.vehicle.findUniqueOrThrow({ where: { id }, include }));
  });
}

export async function setFeaturedVehicle(tenantId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.findFirst({ where: { id, tenantId } });
    if (!v) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
    if (!v.active || v.archivedAt) {
      throw new VehicleError("Seul un véhicule actif peut être mis en avant.", "NOT_ACTIVE", 409);
    }
    await tx.vehicle.updateMany({ where: { tenantId, featured: true, NOT: { id } }, data: { featured: false } });
    await tx.vehicle.update({ where: { id }, data: { featured: true } });
    return toProVehicle(await tx.vehicle.findUniqueOrThrow({ where: { id }, include }));
  });
}

/** Archivage (jamais de suppression physique : l'historique des devis/réservations garde sa référence). */
export async function archiveVehicle(tenantId: string, id: string) {
  const v = await prisma.vehicle.findFirst({ where: { id, tenantId } });
  if (!v) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
  const today = DateTime.now().setZone(tenantTimezone(tenantId)).toISODate()!;
  const upcoming = await prisma.vehicleDayOccupation.count({
    where: { vehicleId: id, leadId: { not: null }, day: { gte: dayKeyToDate(today) } },
  });
  if (upcoming > 0) {
    throw new VehicleError(
      `Ce véhicule a ${upcoming} jour(s) de réservation à venir : changez le véhicule de ces réservations avant de l'archiver (ou désactivez-le simplement).`,
      "HAS_UPCOMING_BOOKINGS",
      409
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { archivedAt: new Date(), active: false, featured: false } });
    await ensureFeaturedExists(tx, tenantId);
    return toProVehicle(await tx.vehicle.findUniqueOrThrow({ where: { id }, include }));
  });
}

export async function restoreVehicle(tenantId: string, id: string) {
  const v = await prisma.vehicle.findFirst({ where: { id, tenantId } });
  if (!v) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
  return prisma.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { archivedAt: null } });
    await ensureFeaturedExists(tx, tenantId);
    return toProVehicle(await tx.vehicle.findUniqueOrThrow({ where: { id }, include }));
  });
}

// ---------------------------------------------------------------------------
// Photos (5 maximum, contrainte aussi en base : CHECK position 0..4 + UNIQUE(vehicleId, position))
// ---------------------------------------------------------------------------

async function ownedVehicle(tenantId: string, vehicleId: string) {
  const v = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true, name: true } });
  if (!v) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
  return v;
}

/** Supprime le fichier sauf s'il est encore cité par un devis/une réservation (snapshot historique). */
async function deleteFileUnlessReferenced(tenantId: string, url: string) {
  const refs = await prisma.leadRequest.count({
    where: { tenantId, vehicleSnapshot: { path: ["photoUrl"], equals: url } },
  });
  if (refs === 0) await deleteStoredPhoto(tenantId, url);
}

export async function addVehiclePhoto(tenantId: string, vehicleId: string, file: Buffer, alt?: string) {
  const vehicle = await ownedVehicle(tenantId, vehicleId);
  const count = await prisma.vehiclePhoto.count({ where: { vehicleId } });
  if (count >= MAX_VEHICLE_PHOTOS) {
    throw new VehicleError(`Maximum ${MAX_VEHICLE_PHOTOS} photos par véhicule.`, "PHOTO_LIMIT", 409);
  }
  const stored = await storeVehiclePhoto(tenantId, file);
  try {
    const used = await prisma.vehiclePhoto.findMany({ where: { vehicleId }, select: { position: true } });
    const taken = new Set(used.map((u) => u.position));
    let position = 0;
    while (taken.has(position)) position++;
    if (position >= MAX_VEHICLE_PHOTOS) throw new VehicleError(`Maximum ${MAX_VEHICLE_PHOTOS} photos par véhicule.`, "PHOTO_LIMIT", 409);
    await prisma.vehiclePhoto.create({
      data: { tenantId, vehicleId, url: stored.url, alt: (alt ?? "").slice(0, 160) || vehicle.name, position },
    });
  } catch (e) {
    await deleteStoredPhoto(tenantId, stored.url);
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2002" || e.code === "P2004")) {
      throw new VehicleError(`Maximum ${MAX_VEHICLE_PHOTOS} photos par véhicule.`, "PHOTO_LIMIT", 409);
    }
    throw e;
  }
  return (await getProVehicle(tenantId, vehicleId))!;
}

export async function replaceVehiclePhoto(tenantId: string, vehicleId: string, photoId: string, file: Buffer) {
  await ownedVehicle(tenantId, vehicleId);
  const photo = await prisma.vehiclePhoto.findFirst({ where: { id: photoId, vehicleId, tenantId } });
  if (!photo) throw new VehicleError("Photo introuvable.", "NOT_FOUND", 404);
  const stored = await storeVehiclePhoto(tenantId, file);
  try {
    await prisma.vehiclePhoto.update({ where: { id: photo.id }, data: { url: stored.url } });
  } catch (e) {
    await deleteStoredPhoto(tenantId, stored.url);
    throw e;
  }
  await deleteFileUnlessReferenced(tenantId, photo.url);
  return (await getProVehicle(tenantId, vehicleId))!;
}

export async function updateVehiclePhotoAlt(tenantId: string, vehicleId: string, photoId: string, alt: string) {
  await ownedVehicle(tenantId, vehicleId);
  const res = await prisma.vehiclePhoto.updateMany({
    where: { id: photoId, vehicleId, tenantId },
    data: { alt: alt.trim().slice(0, 160) },
  });
  if (res.count === 0) throw new VehicleError("Photo introuvable.", "NOT_FOUND", 404);
  return (await getProVehicle(tenantId, vehicleId))!;
}

export async function removeVehiclePhoto(tenantId: string, vehicleId: string, photoId: string) {
  await ownedVehicle(tenantId, vehicleId);
  const removed = await prisma.$transaction(async (tx) => {
    const photo = await tx.vehiclePhoto.findFirst({ where: { id: photoId, vehicleId, tenantId } });
    if (!photo) throw new VehicleError("Photo introuvable.", "NOT_FOUND", 404);
    await tx.vehiclePhoto.delete({ where: { id: photo.id } });
    const rest = await tx.vehiclePhoto.findMany({ where: { vehicleId }, orderBy: { position: "asc" } });
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].position !== i) await tx.vehiclePhoto.update({ where: { id: rest[i].id }, data: { position: i } });
    }
    return photo;
  });
  await deleteFileUnlessReferenced(tenantId, removed.url);
  return (await getProVehicle(tenantId, vehicleId))!;
}

/** `orderedIds` doit contenir exactement les photos actuelles ; la première devient la photo principale. */
export async function reorderVehiclePhotos(tenantId: string, vehicleId: string, orderedIds: string[]) {
  await ownedVehicle(tenantId, vehicleId);
  await prisma.$transaction(async (tx) => {
    const current = await tx.vehiclePhoto.findMany({ where: { vehicleId, tenantId }, select: { id: true } });
    const a = [...current.map((c) => c.id)].sort();
    const b = [...new Set(orderedIds)].sort();
    if (a.length !== b.length || a.some((id, i) => id !== b[i])) {
      throw new VehicleError("La liste des photos ne correspond pas aux photos du véhicule.", "VALIDATION_ERROR");
    }
    // Contrainte UNIQUE(vehicleId, position) DEFERRABLE INITIALLY DEFERRED : l'échange est validé au COMMIT.
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.vehiclePhoto.update({ where: { id: orderedIds[i] }, data: { position: i } });
    }
  });
  return (await getProVehicle(tenantId, vehicleId))!;
}

export async function setVehicleCoverPhoto(tenantId: string, vehicleId: string, photoId: string) {
  const photos = await prisma.vehiclePhoto.findMany({ where: { vehicleId, tenantId }, orderBy: { position: "asc" }, select: { id: true } });
  if (!photos.some((p) => p.id === photoId)) throw new VehicleError("Photo introuvable.", "NOT_FOUND", 404);
  return reorderVehiclePhotos(tenantId, vehicleId, [photoId, ...photos.map((p) => p.id).filter((id) => id !== photoId)]);
}

// ---------------------------------------------------------------------------
// Sélection par un client (calculateur / devis / réservation)
// ---------------------------------------------------------------------------

export class VehicleSelectionError extends Error {
  constructor(
    message: string,
    public readonly code: "VEHICLE_REQUIRED" | "VEHICLE_NOT_FOUND" | "VEHICLE_INACTIVE" | "VEHICLE_CAPACITY",
    public readonly status = 400
  ) {
    super(message);
    this.name = "VehicleSelectionError";
  }
}

/** Extrait l'identifiant de véhicule du corps : SEUL champ véhicule accepté du navigateur. */
export function extractVehicleId(body: Record<string, unknown>): string | null {
  const direct = body.vehicleId;
  const general = (body.general as Record<string, unknown> | undefined)?.vehicleId;
  const v = typeof direct === "string" ? direct : typeof general === "string" ? general : null;
  const t = v?.trim();
  return t ? t.slice(0, 80) : null;
}

function toInt(v: unknown): number {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Passagers et bagages demandés, quel que soit le type de service. */
export function extractGroupSize(body: Record<string, unknown>): { passengers: number; bags: number } {
  const t = (body.trajetClassique ?? {}) as Record<string, unknown>;
  const a = (body.transfertAeroport ?? {}) as Record<string, unknown>;
  const passengers = Math.max(toInt(t.TCpassagers), toInt(a.TApassagers));
  const bags = Math.max(
    toInt(t.TCbagagesaller),
    toInt(t.TCbagagesretour),
    toInt(a.TAbagagesaller),
    toInt(a.TAbagagesretour)
  );
  return { passengers, bags };
}

export type SelectedVehicle = VehicleForPricing & { id: string };

/**
 * Charge la VRAIE configuration du véhicule depuis la base, restreinte au tenant de la requête.
 * Un véhicule d'un autre tenant est indiscernable d'un véhicule inexistant.
 * Retourne null uniquement si le tenant n'a aucun véhicule actif et qu'aucun id n'est fourni (anciens sites).
 */
export async function resolveVehicleForRequest(
  tenantId: string,
  body: Record<string, unknown>
): Promise<SelectedVehicle | null> {
  const vehicleId = extractVehicleId(body);
  if (!vehicleId) {
    if ((await countSelectableVehicles(tenantId)) > 0) {
      throw new VehicleSelectionError("Choisissez un véhicule pour continuer.", "VEHICLE_REQUIRED");
    }
    return null;
  }
  const v = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId },
    include: { photos: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!v) throw new VehicleSelectionError("Véhicule introuvable.", "VEHICLE_NOT_FOUND", 404);
  if (!v.active || v.archivedAt) {
    throw new VehicleSelectionError("Ce véhicule n'est plus proposé.", "VEHICLE_INACTIVE", 409);
  }

  const { passengers, bags } = extractGroupSize(body);
  if (passengers > v.passengerMax) {
    throw new VehicleSelectionError(
      `${v.name} accueille ${v.passengerMax} passager(s) maximum : choisissez un véhicule plus grand.`,
      "VEHICLE_CAPACITY",
      422
    );
  }
  if (v.largeBags != null && bags > v.largeBags) {
    throw new VehicleSelectionError(
      `${v.name} accepte ${v.largeBags} gros bagage(s) maximum : choisissez un véhicule plus grand.`,
      "VEHICLE_CAPACITY",
      422
    );
  }
  return {
    id: v.id,
    name: v.name,
    brand: v.brand,
    model: v.model,
    category: v.category,
    passengerMax: v.passengerMax,
    luggageLabel: v.luggageLabel,
    photoUrl: v.photos[0]?.url ?? null,
    surchargeMode: v.surchargeMode,
    surchargeValue: num(v.surchargeValue),
  };
}

/** Dates (jour civil) d'une période [start, end] pour l'API de disponibilité. */
export { dateToDayKey };

// ---------------------------------------------------------------------------
// Compatibilité vitrine : `settings.vehicles` dérivé de la table Vehicle
// ---------------------------------------------------------------------------

type LegacyGalleryItem = { src: string; alt: string; tag: string };
type LegacyVehicleItem = {
  id: string;
  name: string;
  headline: string;
  passengerMax: number;
  highlightText: string;
  paymentChips: string[];
  gallery: LegacyGalleryItem[];
  baggageLabel: string;
  enabled: boolean;
} & Record<string, unknown>;

function toVitrineItem(v: PublicVehicle): LegacyVehicleItem {
  const equipments = [
    v.airConditioning ? "Climatisation" : null,
    v.wifi ? "Wi-Fi" : null,
    v.usbChargers ? "Chargeurs USB" : null,
    v.babySeats ? "Sièges bébé" : null,
    v.accessible ? "Accessible" : null,
    ...v.features,
  ].filter((x): x is string => !!x);
  return {
    id: v.id,
    name: v.name,
    headline: v.shortDescription || `${v.passengerMax} passagers max`,
    passengerMax: v.passengerMax,
    highlightText: equipments.join(" · "),
    paymentChips: v.paymentChips,
    gallery: v.photos.map((p, i) => ({ src: p.src, alt: p.alt, tag: i === 0 ? "Votre véhicule" : "" })),
    baggageLabel: v.luggageLabel ?? "",
    enabled: true,
    brand: v.brand,
    model: v.model,
    category: v.category,
    description: v.description,
    features: v.features,
    surcharge: v.surcharge,
  };
}

/**
 * Si le tenant a une flotte en base, elle devient la source de vérité de `settings.vehicles` (format historique conservé
 * pour ne pas toucher au design du site public). Sinon (tenant non migré), le JSON d'origine est servi tel quel.
 * Aucune donnée interne (immatriculation, référence interne) n'est incluse.
 */
/** Réglages `vehicles` d'un tenant en mode flotte sans aucun véhicule : rien n'est affiché sur la vitrine. */
export function emptyFleetSettings(): Record<string, unknown> {
  return {
    source: "fleet",
    featuredVehicleId: "",
    featured: { id: "", name: "", headline: "", passengerMax: 1, highlightText: "", paymentChips: [], gallery: [] },
    items: [],
  };
}

export async function applyFleetToSettings(
  tenantId: string,
  settings: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (!settings) return settings;
  const total = await prisma.vehicle.count({ where: { tenantId } });
  if (total === 0) {
    const legacy = settings.vehicles;
    if (legacy && typeof legacy === "object" && (legacy as { source?: unknown }).source === "fleet") {
      return { ...settings, vehicles: emptyFleetSettings() };
    }
    return settings;
  }

  const vehicles = await listPublicVehicles(tenantId);
  const items = vehicles.map(toVitrineItem);
  const spotlight = vehicles.find((v) => v.featured) ?? vehicles[0];
  const featured = items.find((i) => i.id === spotlight?.id) ?? {
    id: "",
    name: "",
    headline: "",
    passengerMax: 1,
    highlightText: "",
    paymentChips: [],
    gallery: [],
  };
  return {
    ...settings,
    vehicles: { source: "fleet", featuredVehicleId: featured.id, featured, items },
  };
}

/** À la sauvegarde des paramètres du site : `settings.vehicles` n'est plus écrit (la flotte vit en base) → on conserve le JSON d'origine. */
export async function keepLegacyVehiclesOnSave(
  tenantId: string,
  incoming: Record<string, unknown>,
  existing: unknown
): Promise<Record<string, unknown>> {
  const total = await prisma.vehicle.count({ where: { tenantId } });
  if (total === 0) return incoming;
  const prevVehicles = existing && typeof existing === "object" ? (existing as Record<string, unknown>).vehicles : undefined;
  const next = { ...incoming };
  if (prevVehicles === undefined) delete next.vehicles;
  else next.vehicles = prevVehicles;
  return next;
}
