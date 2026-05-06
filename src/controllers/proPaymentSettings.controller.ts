import type { NextFunction, Request, Response } from "express";
import { Prisma, TenantPaymentMode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { sendValidationError } from "../utils/apiResponse";

/** Clés interdites (exact + quelques variantes évidentes). */
const FORBIDDEN_KEYS = new Set<string>([
  "platformApplicationFeeAmount",
  "stripeAccountId",
  "stripeChargesEnabled",
  "stripePayoutsEnabled",
  "stripeDetailsSubmitted",
  "stripeOnboardingStatus",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "secret",
  "apiKey",
  "password",
  "ApiKey",
  "APIKey",
  "SECRET",
  "Secret",
  "PASSWORD",
  "Password",
]);

function assertNoForbiddenKeys(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Corps JSON attendu : un objet.";
  }
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return `Clé interdite : « ${key} ».`;
    }
  }
  return null;
}

const patchBodySchema = z
  .object({
    paymentOnlineEnabled: z.boolean(),
    paymentMode: z.nativeEnum(TenantPaymentMode),
    depositPercent: z.union([z.number().int().min(1).max(99), z.null()]),
    depositFixedAmount: z.union([z.number().int().min(1), z.null()]),
    paymentCurrency: z.literal("eur"),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMode === TenantPaymentMode.FULL) {
      if (data.depositPercent !== null) {
        ctx.addIssue({
          code: "custom",
          message:
            "En mode FULL, depositPercent doit être null (pas d’acompte).",
          path: ["depositPercent"],
        });
      }
      if (data.depositFixedAmount !== null) {
        ctx.addIssue({
          code: "custom",
          message:
            "En mode FULL, depositFixedAmount doit être null (pas d’acompte).",
          path: ["depositFixedAmount"],
        });
      }
      return;
    }
    const hasPercent = data.depositPercent !== null;
    const hasFixed = data.depositFixedAmount !== null;
    if (hasPercent && hasFixed) {
      ctx.addIssue({
        code: "custom",
        message:
          "En mode DEPOSIT, renseigner soit depositPercent, soit depositFixedAmount, pas les deux.",
        path: ["depositPercent"],
      });
    }
    if (!hasPercent && !hasFixed) {
      ctx.addIssue({
        code: "custom",
        message:
          "En mode DEPOSIT, renseigner depositPercent (1–99) ou depositFixedAmount (centimes > 0).",
        path: ["depositPercent"],
      });
    }
  });

/**
 * GET /api/pro/payment-settings — lecture DB uniquement (pas d’appel Stripe).
 */
export async function getProPaymentSettings(
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

  try {
    const row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        paymentOnlineEnabled: true,
        paymentMode: true,
        depositPercent: true,
        depositFixedAmount: true,
        paymentCurrency: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
        stripeOnboardingStatus: true,
      },
    });

    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: "TENANT_NOT_FOUND", message: "Locataire introuvable en base." },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        paymentOnlineEnabled: row.paymentOnlineEnabled,
        paymentMode: row.paymentMode,
        depositPercent: row.depositPercent,
        depositFixedAmount: row.depositFixedAmount,
        paymentCurrency: row.paymentCurrency,
        stripe: {
          stripeAccountId: row.stripeAccountId,
          chargesEnabled: row.stripeChargesEnabled,
          payoutsEnabled: row.stripePayoutsEnabled,
          detailsSubmitted: row.stripeDetailsSubmitted,
          onboardingStatus: row.stripeOnboardingStatus,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PATCH /api/pro/payment-settings — remplace les champs paiement éditables (pas la commission ni Stripe).
 */
export async function patchProPaymentSettings(
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

  const forbiddenMsg = assertNoForbiddenKeys(req.body);
  if (forbiddenMsg) {
    sendValidationError(res, forbiddenMsg);
    return;
  }

  const parsed = patchBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.flatten();
    sendValidationError(
      res,
      "Paramètres de paiement invalides.",
      first.fieldErrors
    );
    return;
  }

  const data = parsed.data;

  try {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        paymentOnlineEnabled: data.paymentOnlineEnabled,
        paymentMode: data.paymentMode,
        depositPercent:
          data.paymentMode === TenantPaymentMode.FULL ? null : data.depositPercent,
        depositFixedAmount:
          data.paymentMode === TenantPaymentMode.FULL ? null : data.depositFixedAmount,
        paymentCurrency: data.paymentCurrency,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        paymentOnlineEnabled: data.paymentOnlineEnabled,
        paymentMode: data.paymentMode,
        depositPercent:
          data.paymentMode === TenantPaymentMode.FULL ? null : data.depositPercent,
        depositFixedAmount:
          data.paymentMode === TenantPaymentMode.FULL ? null : data.depositFixedAmount,
        paymentCurrency: data.paymentCurrency,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({
        success: false,
        error: { code: "TENANT_NOT_FOUND", message: "Locataire introuvable en base." },
      });
      return;
    }
    next(e);
  }
}
