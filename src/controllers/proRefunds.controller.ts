import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { BookingCancellationError } from "../services/bookingCancellation.service";
import { getRefundService } from "../services/refundContainer";
import { REFUND_REASONS, RefundServiceError } from "../services/stripe/refund.service";

export function sendDomainError(res: Response, next: NextFunction, e: unknown): void {
  if (e instanceof RefundServiceError || e instanceof BookingCancellationError) {
    res.status(e.httpStatus).json({
      success: false,
      error: {
        code: e.code,
        message: e.message,
        ...(e instanceof RefundServiceError && e.details ? { details: e.details } : {}),
      },
    });
    return;
  }
  next(e);
}

function tenantIdOf(req: Request, res: Response): string | null {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentification requise." } });
    return null;
  }
  return tenantId;
}

const createBodySchema = z
  .object({
    full: z.boolean().optional().default(false),
    amountCents: z.number().int().min(1).max(10_000_000).optional(),
    reason: z.enum(REFUND_REASONS),
    note: z.string().trim().max(500).optional(),
    clientRequestId: z.string().min(8).max(100),
    /** Le chauffeur doit avoir validé le récapitulatif : jamais de remboursement implicite. */
    confirmed: z.literal(true),
  })
  .strict()
  .refine((b) => b.full || b.amountCents !== undefined, { message: "Montant ou remboursement intégral requis." });

/** GET /api/pro/payments/:paymentId — détail paiement + remboursements. */
export async function getProPaymentDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = tenantIdOf(req, res);
  if (!tenantId) return;
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, tenantId },
      select: {
        id: true,
        leadRequestId: true,
        status: true,
        mode: true,
        amount: true,
        currency: true,
        applicationFeeAmount: true,
        refundedAmount: true,
        applicationFeeRefundedAmount: true,
        stripeReceiptUrl: true,
        paidAt: true,
        createdAt: true,
        refundsSyncedAt: true,
        leadRequest: { select: { clientName: true, status: true } },
        refunds: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            reason: true,
            reasonNote: true,
            failureReason: true,
            initiatedBy: true,
            applicationFeeRefunded: true,
            applicationFeeRefundExpected: true,
            stripeRefundId: true,
            lastSyncedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!payment) {
      res.status(404).json({ success: false, error: { code: "PAYMENT_NOT_FOUND", message: "Paiement introuvable." } });
      return;
    }
    res.json({ success: true, data: payment });
  } catch (e) {
    next(e);
  }
}

const previewQuerySchema = z.object({ amountCents: z.coerce.number().int().min(1).max(10_000_000).optional() });

/** GET /api/pro/payments/:paymentId/refund-preview?amountCents= */
export async function getProRefundPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = tenantIdOf(req, res);
  if (!tenantId) return;
  const q = previewQuerySchema.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Montant invalide." } });
    return;
  }
  try {
    const preview = await getRefundService().preview({
      tenantId,
      paymentId: req.params.paymentId,
      amountCents: q.data.amountCents,
    });
    res.json({ success: true, data: preview });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}

/** POST /api/pro/payments/:paymentId/refunds */
export async function postProRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = tenantIdOf(req, res);
  if (!tenantId || !req.authUser) return;
  const parsed = createBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Demande de remboursement invalide.", details: parsed.error.flatten() },
    });
    return;
  }
  try {
    const result = await getRefundService().requestRefund({
      tenantId,
      paymentId: req.params.paymentId,
      full: parsed.data.full,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      note: parsed.data.note,
      clientRequestId: parsed.data.clientRequestId,
      initiatedByUserId: req.authUser.id,
    });
    res.status(result.deduplicated ? 200 : 201).json({
      success: true,
      data: {
        refundId: result.refund.id,
        status: result.refund.status,
        /** true uniquement si Stripe a confirmé (status succeeded). Sinon : « en cours ». */
        confirmed: result.confirmed,
        deduplicated: result.deduplicated,
        amount: result.refund.amount,
        currency: result.refund.currency,
        applicationFeeRefundExpected: result.refund.applicationFeeRefundExpected,
        paymentStatus: result.payment.status,
        refundedAmount: result.payment.refundedAmount,
      },
    });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}

/** POST /api/pro/payments/:paymentId/sync — réaligne la base sur l'état Stripe. */
export async function postProPaymentSync(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = tenantIdOf(req, res);
  if (!tenantId) return;
  try {
    const payment = await getRefundService().syncPayment({ tenantId, paymentId: req.params.paymentId });
    res.json({
      success: true,
      data: { paymentStatus: payment.status, refundedAmount: payment.refundedAmount },
    });
  } catch (e) {
    sendDomainError(res, next, e);
  }
}
