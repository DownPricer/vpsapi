import type { NextFunction, Request, Response } from "express";
import { LeadKind, LeadStatus } from "@prisma/client";
import { z } from "zod";
import { RequestService } from "../services/request.service";

const requestService = new RequestService();

const listQuerySchema = z.object({
  kind: z.nativeEnum(LeadKind).optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const statusBodySchema = z.object({
  status: z.nativeEnum(LeadStatus),
  note: z.string().max(2000).optional(),
});

const noteBodySchema = z.object({
  note: z.string().max(5000).nullable(),
});

function dateOrUndefined(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export async function getRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Filtres invalides." } });
      return;
    }
    const rows = await requestService.list(req.tenantId, {
      kind: parsed.data.kind,
      status: parsed.data.status,
      q: parsed.data.q,
      from: dateOrUndefined(parsed.data.from),
      to: dateOrUndefined(parsed.data.to),
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
}

export async function getRequestById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const row = await requestService.getById(req.tenantId, req.params.id);
    if (!row) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Demande introuvable." } });
      return;
    }
    res.json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
}

export async function patchRequestStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = statusBodySchema.safeParse(req.body ?? {});
  if (!parsed.success || !req.authUser) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Statut invalide." } });
    return;
  }
  try {
    const updated = await requestService.updateStatus({
      tenantId: req.tenantId,
      leadId: req.params.id,
      nextStatus: parsed.data.status,
      changedByUserId: req.authUser.id,
      note: parsed.data.note,
    });
    if (!updated) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Demande introuvable." } });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

export async function patchRequestNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = noteBodySchema.safeParse(req.body ?? {});
  if (!parsed.success || !req.authUser) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Note invalide." } });
    return;
  }
  try {
    const updated = await requestService.updateNote({
      tenantId: req.tenantId,
      leadId: req.params.id,
      note: parsed.data.note,
      changedByUserId: req.authUser.id,
    });
    if (!updated) {
      res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Demande introuvable." } });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}
