import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import {
  BookingCancellationError,
  createCustomerCancellationRequest,
  getCustomerBookingView,
} from "../services/bookingCancellation.service";
import { parseStoredPolicy, policyLines } from "../services/cancellationPolicy";

function fail(res: Response, next: NextFunction, e: unknown): void {
  if (e instanceof BookingCancellationError) {
    res.status(e.httpStatus).json({ success: false, error: { code: e.code, message: e.message } });
    return;
  }
  next(e);
}

const tokenBody = z.object({ token: z.string().min(20).max(200) }).strict();
const requestBody = z
  .object({ token: z.string().min(20).max(200), reason: z.string().trim().min(5).max(1000) })
  .strict();

// Réponses jamais mises en cache : elles dépendent d'un jeton secret.
function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/** POST /api/public/booking/view — { token } */
export async function postPublicBookingView(req: Request, res: Response, next: NextFunction): Promise<void> {
  noStore(res);
  const parsed = tokenBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "LINK_INVALID", message: "Lien invalide." } });
    return;
  }
  try {
    const view = await getCustomerBookingView(req.tenant, req.tenantId, parsed.data.token);
    res.json({ success: true, data: view });
  } catch (e) {
    fail(res, next, e);
  }
}

/** POST /api/public/booking/cancellation-request — { token, reason } */
export async function postPublicCancellationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  noStore(res);
  const parsed = requestBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Indiquez un motif (5 caractères minimum)." },
    });
    return;
  }
  try {
    const out = await createCustomerCancellationRequest(req.tenant, req.tenantId, parsed.data.token, parsed.data.reason);
    res.status(201).json({ success: true, data: { requestId: out.requestId, status: out.status } });
  } catch (e) {
    fail(res, next, e);
  }
}

/** GET /api/public/cancellation-policy — conditions en vigueur, à afficher avant paiement. */
export async function getPublicCancellationPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const t = await prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { cancellationPolicy: true } });
    const policy = parseStoredPolicy(t?.cancellationPolicy ?? null);
    res.json({
      success: true,
      data: policy ? { version: policy.version, lines: policyLines(policy) } : null,
    });
  } catch (e) {
    next(e);
  }
}
