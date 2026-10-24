import type { NextFunction, Request, Response } from "express";
import { CancellationRequestStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import {
  cancelBooking,
  previewCancellation,
  resolveCancellationRequest,
  type RefundPlan,
} from "../services/bookingCancellation.service";
import {
  cancellationPolicyInputSchema,
  isPolicyContentEmpty,
  nextPolicy,
  parseStoredPolicy,
} from "../services/cancellationPolicy";
import { sendDomainError } from "./proRefunds.controller";

function authOf(req: Request, res: Response): { tenantId: string; userId: string } | null {
  if (!req.authUser) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentification requise." } });
    return null;
  }
  return { tenantId: req.authUser.tenantId, userId: req.authUser.id };
}

const refundPlanSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("full") }),
  z.object({ mode: z.literal("partial"), amountCents: z.number().int().min(1).max(10_000_000) }),
]);

const cancelBodySchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    refund: refundPlanSchema.default({ mode: "none" }),
    refundConfirmed: z.boolean().default(false),
    clientRequestId: z.string().min(8).max(100),
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

const resolveBodySchema = z
  .object({
    decision: z.enum(["accept", "refuse", "manual"]),
    refund: refundPlanSchema.default({ mode: "none" }),
    refundConfirmed: z.boolean().default(false),
    clientRequestId: z.string().min(8).max(100),
    note: z.string().trim().max(500).optional(),
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

function validationError(res: Response, flat: unknown): void {
  res.status(400).json({
    success: false,
    error: { code: "VALIDATION_ERROR", message: "Données invalides.", details: flat },
  });
}

/** GET /api/pro/demandes/:id/cancel-preview */
export async function getCancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  try {
    res.json({ success: true, data: await previewCancellation(auth.tenantId, req.params.id) });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}

/** POST /api/pro/demandes/:id/cancel */
export async function postCancelBooking(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  const parsed = cancelBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  try {
    const out = await cancelBooking({
      tenant: req.tenant,
      tenantId: auth.tenantId,
      leadId: req.params.id,
      actorUserId: auth.userId,
      reason: parsed.data.reason,
      refund: parsed.data.refund as RefundPlan,
      refundConfirmed: parsed.data.refundConfirmed,
      clientRequestId: parsed.data.clientRequestId,
      notifyCustomer: parsed.data.notifyCustomer,
    });
    res.json({ success: true, data: serializeCancelResult(out) });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}

function serializeCancelResult(out: Awaited<ReturnType<typeof cancelBooking>>) {
  return {
    leadId: out.lead.id,
    status: out.lead.status,
    paymentStatus: out.lead.paymentStatus,
    unpaidPaymentsCancelled: out.unpaidPaymentsCancelled,
    refund: out.refund
      ? {
          refundId: out.refund.refund.id,
          status: out.refund.refund.status,
          confirmed: out.refund.confirmed,
          amount: out.refund.refund.amount,
          currency: out.refund.refund.currency,
        }
      : null,
    refundUncertain: out.refundUncertain,
    customerMailSent: out.mail ? out.mail.sent : null,
  };
}

/** POST /api/pro/demandes/:id/cancellation-request/resolve */
export async function postResolveCancellationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  const parsed = resolveBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  try {
    const out = await resolveCancellationRequest({
      tenant: req.tenant,
      tenantId: auth.tenantId,
      leadId: req.params.id,
      actorUserId: auth.userId,
      decision: parsed.data.decision,
      refund: parsed.data.refund as RefundPlan,
      refundConfirmed: parsed.data.refundConfirmed,
      clientRequestId: parsed.data.clientRequestId,
      note: parsed.data.note,
      notifyCustomer: parsed.data.notifyCustomer,
    });
    res.json({
      success: true,
      data: out.result
        ? serializeCancelResult(out.result)
        : { leadId: out.lead.id, status: out.lead.status, paymentStatus: out.lead.paymentStatus, refund: null },
    });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}

/** GET /api/pro/cancellation-requests — demandes en attente (bandeau + liste). */
export async function getPendingCancellationRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  try {
    const rows = await prisma.cancellationRequest.findMany({
      where: { tenantId: auth.tenantId, status: CancellationRequestStatus.PENDING },
      orderBy: { requestedAt: "desc" },
      take: 50,
      select: {
        id: true,
        leadRequestId: true,
        reason: true,
        requestedAt: true,
        leadRequest: { select: { clientName: true, scheduledStart: true, paymentStatus: true } },
      },
    });
    res.json({ success: true, data: { items: rows, total: rows.length } });
  } catch (e) {
    next(e);
  }
}

/** GET /api/pro/demandes/:id/cancellation-request — dernière demande du dossier. */
export async function getLeadCancellationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  try {
    const row = await prisma.cancellationRequest.findFirst({
      where: { tenantId: auth.tenantId, leadRequestId: req.params.id },
      orderBy: { requestedAt: "desc" },
    });
    res.json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
}

/** GET /api/pro/cancellation-policy */
export async function getProCancellationPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  try {
    const t = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { cancellationPolicy: true } });
    res.json({ success: true, data: { policy: parseStoredPolicy(t?.cancellationPolicy ?? null) } });
  } catch (e) {
    next(e);
  }
}

/** PUT /api/pro/cancellation-policy — nouvelle version ; n'altère jamais les réservations déjà enregistrées. */
export async function putProCancellationPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = authOf(req, res);
  if (!auth) return;
  const parsed = cancellationPolicyInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationError(res, parsed.error.flatten());
  try {
    const t = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { cancellationPolicy: true } });
    if (isPolicyContentEmpty(parsed.data)) {
      await prisma.tenant.update({ where: { id: auth.tenantId }, data: { cancellationPolicy: Prisma.DbNull } });
      res.json({ success: true, data: { policy: null } });
      return;
    }
    const policy = nextPolicy(parsed.data, parseStoredPolicy(t?.cancellationPolicy ?? null));
    await prisma.tenant.update({ where: { id: auth.tenantId }, data: { cancellationPolicy: policy } });
    res.json({ success: true, data: { policy } });
  } catch (e) {
    next(e);
  }
}
