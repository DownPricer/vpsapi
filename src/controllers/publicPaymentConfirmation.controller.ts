import type { NextFunction, Request, Response } from "express";
import { PaymentStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * GET /api/public/payment-confirmation?session_id=cs_...
 * Lecture seule, résolu par tenant middleware (X-Tenant-ID).
 */
export async function getPublicPaymentConfirmation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const raw = req.query.session_id;
  const sessionId = typeof raw === "string" ? raw.trim() : "";
  if (!sessionId.startsWith("cs_")) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_SESSION",
        message: "Identifiant de session Stripe manquant ou invalide.",
      },
    });
    return;
  }

  try {
    const payment = await prisma.payment.findFirst({
      where: { stripeCheckoutSessionId: sessionId, tenantId: req.tenantId },
      select: {
        status: true,
        amount: true,
        currency: true,
        leadRequestId: true,
        stripeReceiptUrl: true,
      },
    });

    if (!payment) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Aucun paiement trouvé pour cette session.",
        },
      });
      return;
    }

    const confirmationPending = payment.status !== PaymentStatus.PAID;

    res.json({
      success: true,
      data: {
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        leadReference: payment.leadRequestId,
        receiptUrl: payment.stripeReceiptUrl ?? null,
        confirmationPending,
      },
    });
  } catch (e) {
    next(e);
  }
}
