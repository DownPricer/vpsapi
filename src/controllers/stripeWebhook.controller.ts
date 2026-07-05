import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getStripeClient } from "../services/stripe/stripeClient";
import { processStripeWebhookEvent } from "../services/stripeWebhook.service";
import { trackFromRequest } from "../platform/telemetry.service";

function webhookSecret(): string | undefined {
  const s = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return s && s.length > 0 ? s : undefined;
}

/**
 * POST /api/stripe/webhook — body brut (Buffer), hors tenantMiddleware.
 */
export async function postStripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const secret = webhookSecret();
  if (!secret) {
    res.status(503).json({
      success: false,
      error: {
        code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
        message: "Webhook Stripe non configuré sur l’API.",
      },
    });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({
      success: false,
      error: {
        code: "STRIPE_NOT_CONFIGURED",
        message: "Stripe n'est pas configuré sur l'API.",
      },
    });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).json({
      success: false,
      error: {
        code: "STRIPE_WEBHOOK_SIGNATURE_MISSING",
        message: "En-tête stripe-signature manquant.",
      },
    });
    return;
  }

  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({
      success: false,
      error: {
        code: "STRIPE_WEBHOOK_BODY_INVALID",
        message: "Corps de requête invalide pour la vérification Stripe.",
      },
    });
    return;
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch {
    res.status(400).json({
      success: false,
      error: {
        code: "STRIPE_WEBHOOK_SIGNATURE_INVALID",
        message: "Signature webhook Stripe invalide.",
      },
    });
    return;
  }

  void trackFromRequest({
    tenantId: null,
    type: "stripe_webhook_received",
    category: "stripe",
    reqIp: req.ip,
    forwardedFor: typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    path: "/api/stripe/webhook",
    referrer: undefined,
    metadata: { stripeEventType: event.type, stripeEventId: event.id },
  });

  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        type: event.type,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(200).json({ received: true });
      return;
    }
    next(e);
    return;
  }

  try {
    await processStripeWebhookEvent(event);
  } catch (e) {
    await prisma.stripeWebhookEvent.deleteMany({
      where: { stripeEventId: event.id },
    });
    next(e);
    return;
  }

  res.status(200).json({ received: true });
}
