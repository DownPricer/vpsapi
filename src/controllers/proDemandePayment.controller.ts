import type { NextFunction, Request, Response } from "express";
import { PaymentMode } from "@prisma/client";
import { z } from "zod";
import { getTenantConfig } from "../config/tenants/registry";
import { prisma } from "../db/prisma";
import {
  pickVtcPhoneFromTenantSettings,
  resolveClientEmailForPaymentMail,
  sendPaymentLinkToCustomer,
} from "../modules/email/paymentLinkMail";
import { PaymentLinkError, StripePaymentService } from "../services/stripePayment.service";

const paymentLinkBodySchema = z
  .object({
    mode: z.enum(["full", "deposit"]),
    sendEmail: z.boolean().optional().default(false),
    message: z.string().max(1000).optional(),
    forceNewCheckoutSession: z.boolean().optional().default(false),
  })
  .strict();

const stripePaymentService = new StripePaymentService();

export async function postDemandePaymentLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = req.authUser?.tenantId;
  if (!tenantId) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentification requise." },
    });
    return;
  }

  const parsed = paymentLinkBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Corps de requête invalide.",
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  const mode =
    parsed.data.mode === "full" ? PaymentMode.FULL : PaymentMode.DEPOSIT;
  const sendEmail = parsed.data.sendEmail;

  if (sendEmail) {
    const leadPeek = await prisma.leadRequest.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (leadPeek && !resolveClientEmailForPaymentMail(leadPeek)) {
      res.status(400).json({
        success: false,
        error: {
          code: "CLIENT_EMAIL_REQUIRED_FOR_PAYMENT_EMAIL",
          message:
            "Impossible d’envoyer l’e-mail : aucune adresse client valide sur la demande. Renseignez l’e-mail du client ou laissez sendEmail à false.",
        },
      });
      return;
    }
  }

  try {
    const result = await stripePaymentService.createLeadPaymentLink({
      tenantId,
      leadRequestId: req.params.id,
      mode,
      sendEmail,
      message: parsed.data.message,
      forceNewCheckoutSession: parsed.data.forceNewCheckoutSession,
    });

    let emailSent = false;
    let emailErrorCode: string | undefined;

    if (sendEmail) {
      const [lead, tenantRow] = await Promise.all([
        prisma.leadRequest.findFirst({
          where: { id: req.params.id, tenantId },
        }),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { settings: true },
        }),
      ]);
      const tenantCfg = getTenantConfig(tenantId);

      if (!lead || !tenantCfg) {
        emailSent = false;
        emailErrorCode = !tenantCfg ? "TENANT_CONFIG_NOT_FOUND" : "LEAD_NOT_FOUND";
      } else {
        const vtcEmail = tenantCfg.smtp?.toEmail?.trim() || null;
        const vtcPhone = pickVtcPhoneFromTenantSettings(tenantRow?.settings ?? null) ?? null;
        const mailResult = await sendPaymentLinkToCustomer({
          tenant: tenantCfg,
          lead,
          checkoutUrl: result.checkoutUrl,
          amountCents: result.amount,
          vtcPhone,
          vtcEmail,
        });
        emailSent = mailResult.sent;
        emailErrorCode = mailResult.errorCode;
      }
    }

    res.status(result.created ? 201 : 200).json({
      success: true,
      data: {
        paymentId: result.paymentId,
        checkoutUrl: result.checkoutUrl,
        paymentStatus: result.paymentStatus,
        amount: result.amount,
        currency: result.currency,
        applicationFeeAmount: result.applicationFeeAmount,
        reusedExistingCheckout: result.reusedExistingCheckout,
        emailSent: sendEmail ? emailSent : false,
        ...(emailErrorCode ? { emailErrorCode } : {}),
      },
    });
  } catch (e) {
    if (e instanceof PaymentLinkError) {
      res.status(e.httpStatus).json({
        success: false,
        error: { code: e.code, message: e.message },
      });
      return;
    }
    next(e);
  }
}
