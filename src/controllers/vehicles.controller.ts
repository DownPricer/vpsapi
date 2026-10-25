import type { NextFunction, Request, Response } from "express";
import { VehicleBlockReason } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { PhotoUploadError } from "../modules/fleet/photoStorage";
import { dayKeyToDate, eachDayKey, isValidDayKey } from "../modules/fleet/days";
import { changeLeadVehicle, rescheduleLead } from "../services/leadVehicle.service";
import {
  addVehiclePhoto,
  archiveVehicle,
  createVehicle,
  getProVehicle,
  listProVehicles,
  listPublicVehicles,
  removeVehiclePhoto,
  reorderVehiclePhotos,
  replaceVehiclePhoto,
  restoreVehicle,
  setFeaturedVehicle,
  setVehicleCoverPhoto,
  updateVehicle,
  updateVehiclePhotoAlt,
  vehicleWriteSchema,
  VehicleError,
} from "../services/vehicle.service";
import {
  createVehicleBlock,
  deleteVehicleBlock,
  getOccupiedVehicleIds,
  listOccupations,
  listVehicleBlocks,
  tenantTimezone,
} from "../services/vehicleAvailability.service";
import { localDaysBetween } from "../modules/fleet/days";

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const ok = (res: Response, data: unknown, meta?: Record<string, unknown>) => {
  res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
};

const badRequest = (res: Response, message: string, details?: unknown) => {
  res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message, details } });
};

/** Le tenant vient TOUJOURS du jeton/domaine résolu côté serveur (jamais d'un champ envoyé par le navigateur). */
const tid = (req: Request): string => req.authUser!.tenantId;

// ---------------------------------------------------------------------------
// Espace pro — flotte
// ---------------------------------------------------------------------------

export const proListVehicles = wrap(async (req, res) => {
  ok(res, await listProVehicles(tid(req), { includeArchived: req.query.archived === "1" }));
});

export const proGetVehicle = wrap(async (req, res) => {
  const v = await getProVehicle(tid(req), req.params.id);
  if (!v) throw new VehicleError("Véhicule introuvable.", "NOT_FOUND", 404);
  ok(res, v);
});

export const proCreateVehicle = wrap(async (req, res) => {
  const parsed = vehicleWriteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? "Véhicule invalide.", parsed.error.flatten());
  ok(res, await createVehicle(tid(req), parsed.data));
});

export const proUpdateVehicle = wrap(async (req, res) => {
  const parsed = vehicleWriteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? "Véhicule invalide.", parsed.error.flatten());
  ok(res, await updateVehicle(tid(req), req.params.id, parsed.data));
});

export const proFeatureVehicle = wrap(async (req, res) => ok(res, await setFeaturedVehicle(tid(req), req.params.id)));
export const proArchiveVehicle = wrap(async (req, res) => ok(res, await archiveVehicle(tid(req), req.params.id)));
export const proRestoreVehicle = wrap(async (req, res) => ok(res, await restoreVehicle(tid(req), req.params.id)));

// ---- photos ---------------------------------------------------------------

function uploadedBuffer(req: Request): Buffer {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer?.length) throw new PhotoUploadError("Aucun fichier reçu (champ « file »).", "NO_FILE");
  return file.buffer;
}

export const proAddPhoto = wrap(async (req, res) => {
  const alt = typeof req.body?.alt === "string" ? req.body.alt : undefined;
  ok(res, await addVehiclePhoto(tid(req), req.params.id, uploadedBuffer(req), alt));
});

export const proReplacePhoto = wrap(async (req, res) => {
  ok(res, await replaceVehiclePhoto(tid(req), req.params.id, req.params.photoId, uploadedBuffer(req)));
});

export const proPhotoAlt = wrap(async (req, res) => {
  const parsed = z.object({ alt: z.string().max(160) }).safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Texte alternatif invalide.");
  ok(res, await updateVehiclePhotoAlt(tid(req), req.params.id, req.params.photoId, parsed.data.alt));
});

export const proRemovePhoto = wrap(async (req, res) => {
  ok(res, await removeVehiclePhoto(tid(req), req.params.id, req.params.photoId));
});

export const proReorderPhotos = wrap(async (req, res) => {
  const parsed = z.object({ order: z.array(z.string().min(1)).max(5) }).safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Ordre des photos invalide.");
  ok(res, await reorderVehiclePhotos(tid(req), req.params.id, parsed.data.order));
});

export const proCoverPhoto = wrap(async (req, res) => {
  ok(res, await setVehicleCoverPhoto(tid(req), req.params.id, req.params.photoId));
});

// ---- blocages manuels & calendrier ---------------------------------------

const blockSchema = z.object({
  startDay: z.string(),
  endDay: z.string(),
  reason: z.nativeEnum(VehicleBlockReason).default("maintenance"),
  note: z.string().max(500).nullish(),
});

export const proListBlocks = wrap(async (req, res) => {
  ok(res, await listVehicleBlocks(tid(req), req.params.id));
});

export const proCreateBlock = wrap(async (req, res) => {
  const parsed = blockSchema.safeParse(req.body ?? {});
  if (!parsed.success || !isValidDayKey(parsed.data.startDay) || !isValidDayKey(parsed.data.endDay)) {
    return badRequest(res, "Période invalide (format AAAA-MM-JJ).");
  }
  ok(res, await createVehicleBlock({ tenantId: tid(req), vehicleId: req.params.id, ...parsed.data }));
});

export const proDeleteBlock = wrap(async (req, res) => {
  const deleted = await deleteVehicleBlock(tid(req), req.params.blockId);
  if (!deleted) throw new VehicleError("Blocage introuvable.", "NOT_FOUND", 404);
  ok(res, { deleted: true });
});

/** Occupations (réservations + blocages) sur une période, filtrables par véhicule : alimente le calendrier pro. */
export const proVehicleCalendar = wrap(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!isValidDayKey(from) || !isValidDayKey(to) || to < from || eachDayKey(from, to).length > 100) {
    return badRequest(res, "Période invalide (AAAA-MM-JJ, 100 jours maximum).");
  }
  const vehicleId = typeof req.query.vehicleId === "string" && req.query.vehicleId ? req.query.vehicleId : undefined;
  const tenantId = tid(req);
  const occupations = await listOccupations(tenantId, from, to, vehicleId);
  const leadIds = [...new Set(occupations.map((o) => o.leadId).filter((x): x is string => !!x))];
  const leads = leadIds.length
    ? await prisma.leadRequest.findMany({
        where: { id: { in: leadIds }, tenantId },
        select: { id: true, clientName: true, status: true, scheduledStart: true, scheduledEnd: true, flatPayload: true },
      })
    : [];
  ok(res, {
    occupations: occupations.map((o) => ({
      id: o.id,
      vehicleId: o.vehicleId,
      day: o.day.toISOString().slice(0, 10),
      leadId: o.leadId,
      blockId: o.blockId,
      block: o.block ? { reason: o.block.reason, note: o.block.note } : null,
    })),
    leads,
  });
});

// ---- modification d'une réservation ---------------------------------------

export const proChangeLeadVehicle = wrap(async (req, res) => {
  const parsed = z
    .object({ vehicleId: z.string().min(1).max(80).nullable(), note: z.string().max(500).optional() })
    .strict()
    .safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Corps de requête invalide (seul vehicleId est accepté).");
  const out = await changeLeadVehicle({
    tenantId: tid(req),
    leadId: req.params.id,
    vehicleId: parsed.data.vehicleId,
    actorUserId: req.authUser!.id,
    note: parsed.data.note,
  });
  ok(res, out);
});

export const proRescheduleLead = wrap(async (req, res) => {
  const parsed = z
    .object({ scheduledStart: z.string().datetime({ offset: true }), scheduledEnd: z.string().datetime({ offset: true }).nullish() })
    .strict()
    .safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, "Dates invalides (ISO 8601).");
  const updated = await rescheduleLead({
    tenantId: tid(req),
    leadId: req.params.id,
    scheduledStart: new Date(parsed.data.scheduledStart),
    scheduledEnd: parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null,
    actorUserId: req.authUser!.id,
  });
  ok(res, { id: updated.id, scheduledStart: updated.scheduledStart, scheduledEnd: updated.scheduledEnd });
});

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export const publicListVehicles = wrap(async (req, res) => {
  ok(res, await listPublicVehicles(req.tenantId));
});

/**
 * Disponibilité et compatibilité par véhicule pour une date (et passagers/bagages) : alimente l'étape « Choisissez votre véhicule ».
 * Informatif — rien n'est réservé ; l'API revérifie tout à la création du devis et à l'acceptation.
 */
export const publicVehicleAvailability = wrap(async (req, res) => {
  const tenantId = req.tenantId;
  const q = z
    .object({
      date: z.string().optional(),
      dateEnd: z.string().optional(),
      passengers: z.coerce.number().int().min(0).max(99).optional(),
      bags: z.coerce.number().int().min(0).max(99).optional(),
    })
    .safeParse(req.query);
  if (!q.success) return badRequest(res, "Paramètres invalides.");

  const tz = tenantTimezone(tenantId);
  let days: string[] = [];
  const parse = (s?: string) => {
    if (!s) return null;
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? DateTime.fromISO(s, { zone: tz })
      : DateTime.fromFormat(s, "dd/MM/yyyy", { zone: tz });
    return dt.isValid ? dt : null;
  };
  const start = parse(q.data.date);
  const end = parse(q.data.dateEnd) ?? start;
  if (start && end) days = localDaysBetween(start.toJSDate(), end.toJSDate(), tz);

  const vehicles = await listPublicVehicles(tenantId);
  const occupied = await getOccupiedVehicleIds(
    tenantId,
    vehicles.map((v) => v.id),
    days
  );
  const passengers = q.data.passengers ?? 0;
  const bags = q.data.bags ?? 0;
  ok(
    res,
    vehicles.map((v) => {
      const taken = occupied.get(v.id) ?? [];
      const tooManyPassengers = passengers > v.passengerMax;
      const tooManyBags = v.largeBags != null && bags > v.largeBags;
      const available = taken.length === 0;
      return {
        ...v,
        available,
        fits: !tooManyPassengers && !tooManyBags,
        unavailableReason: !available
          ? `${v.name} indisponible à cette date.`
          : tooManyPassengers
            ? `${v.name} accueille ${v.passengerMax} passager(s) maximum.`
            : tooManyBags
              ? `${v.name} accepte ${v.largeBags} gros bagage(s) maximum.`
              : null,
      };
    }),
    { dateChecked: days.length > 0, days }
  );
});

export { dayKeyToDate };
