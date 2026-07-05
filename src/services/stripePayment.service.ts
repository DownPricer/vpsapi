import type { LeadRequest, Tenant } from "@prisma/client";
import {
  LeadPaymentStatus,
  LeadStatus,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { getStripeClient, isStripeConfigured } from "./stripe/stripeClient";
import { trackPlatformEvent } from "../platform/telemetry.service";

export class PaymentLinkError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "PaymentLinkError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const MIN_CHARGE_CENTS = 50;

const LEAD_STATUSES_BLOCKED_FOR_PAYMENT: LeadStatus[] = [
  LeadStatus.refused,
  LeadStatus.cancelled,
  LeadStatus.expired,
  LeadStatus.archived,
];

export type CreateLeadPaymentLinkInput = {
  tenantId: string;
  leadRequestId: string;
  mode: PaymentMode;
  sendEmail?: boolean;
  message?: string;
  /** Si true : annule les paiements en attente / lien ouvert pour cette demande et force une nouvelle session Checkout. */
  forceNewCheckoutSession?: boolean;
};

export type CreateLeadPaymentLinkResult = {
  paymentId: string;
  checkoutUrl: string;
  paymentStatus: PaymentStatus;
  amount: number;
  currency: string;
  applicationFeeAmount: number;
  created: boolean;
  /** true lorsque l’URL renvoyée provient d’une session encore valide (aucune nouvelle session créée). */
  reusedExistingCheckout: boolean;
};

function requireStripe(): NonNullable<ReturnType<typeof getStripeClient>> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new PaymentLinkError(
      "STRIPE_NOT_CONFIGURED",
      "Stripe n'est pas configuré sur l'API.",
      503
    );
  }
  return stripe;
}

/** Stripe remplace {CHECKOUT_SESSION_ID} ; si absent de l’URL env, on l’ajoute en query. */
function normalizeStripeSuccessUrl(raw: string): string {
  const u = raw.trim();
  if (u.includes("{CHECKOUT_SESSION_ID}")) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}session_id={CHECKOUT_SESSION_ID}`;
}

function requirePaymentUrls(): { successUrl: string; cancelUrl: string } {
  const successRaw = process.env.STRIPE_PAYMENT_SUCCESS_URL?.trim();
  const cancelUrl = process.env.STRIPE_PAYMENT_CANCEL_URL?.trim();
  if (!successRaw || !cancelUrl) {
    throw new PaymentLinkError(
      "STRIPE_PAYMENT_URLS_NOT_CONFIGURED",
      "URLs de retour paiement Stripe manquantes côté API.",
      503
    );
  }
  return { successUrl: normalizeStripeSuccessUrl(successRaw), cancelUrl };
}

/**
 * Montant total de la demande en centimes (EUR), depuis pricingResult.tarif (€) ou flatPayload.TarifTotal.
 */
export function resolveLeadTotalAmountCents(lead: LeadRequest): number | null {
  const pr = lead.pricingResult;
  if (pr !== null && typeof pr === "object" && !Array.isArray(pr)) {
    const tarif = (pr as Record<string, unknown>).tarif;
    if (typeof tarif === "number" && Number.isFinite(tarif) && tarif > 0) {
      return Math.round(tarif * 100);
    }
  }
  const flat = lead.flatPayload;
  if (flat !== null && typeof flat === "object" && !Array.isArray(flat)) {
    const tt = (flat as Record<string, unknown>).TarifTotal;
    if (typeof tt === "string" && tt.trim() !== "") {
      const n = Number.parseFloat(tt.replace(",", ".").trim());
      if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
    }
    if (typeof tt === "number" && tt > 0) return Math.round(tt * 100);
  }
  return null;
}

export function resolveLeadPaymentAmountCents(
  lead: LeadRequest,
  mode: PaymentMode,
  tenant: Tenant
): { totalCents: number; chargeCents: number } {
  const totalCents = resolveLeadTotalAmountCents(lead);
  if (totalCents === null || totalCents <= 0) {
    throw new PaymentLinkError(
      "PAYMENT_AMOUNT_NOT_FOUND",
      "Impossible de déterminer le montant de la demande.",
      400
    );
  }

  if (mode === PaymentMode.FULL) {
    return { totalCents, chargeCents: totalCents };
  }

  let chargeCents: number;
  if (tenant.depositPercent != null) {
    chargeCents = Math.round((totalCents * tenant.depositPercent) / 100);
  } else if (tenant.depositFixedAmount != null) {
    chargeCents = tenant.depositFixedAmount;
  } else {
    throw new PaymentLinkError(
      "PAYMENT_DEPOSIT_NOT_CONFIGURED",
      "Aucun acompte n'est configuré pour ce locataire (pourcentage ou montant fixe).",
      400
    );
  }

  if (chargeCents > totalCents) {
    throw new PaymentLinkError(
      "PAYMENT_AMOUNT_INVALID",
      "Le montant d'acompte dépasse le total de la demande.",
      400
    );
  }

  return { totalCents, chargeCents };
}

function validateChargeAndFee(chargeCents: number, applicationFeeAmount: number): void {
  if (chargeCents < MIN_CHARGE_CENTS) {
    throw new PaymentLinkError(
      "PAYMENT_AMOUNT_TOO_LOW",
      `Le montant à payer doit être d'au moins ${MIN_CHARGE_CENTS} centimes.`,
      400
    );
  }
  if (chargeCents <= applicationFeeAmount) {
    throw new PaymentLinkError(
      "AMOUNT_TOO_LOW_FOR_FEE",
      "Le montant est trop faible par rapport à la commission plateforme.",
      400
    );
  }
}

export class StripePaymentService {
  async createLeadPaymentLink(input: CreateLeadPaymentLinkInput): Promise<CreateLeadPaymentLinkResult> {
    if (!isStripeConfigured()) {
      throw new PaymentLinkError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe n'est pas configuré sur l'API.",
        503
      );
    }
    const { successUrl, cancelUrl } = requirePaymentUrls();

    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
    });
    if (!tenant) {
      throw new PaymentLinkError("TENANT_NOT_FOUND", "Locataire introuvable en base.", 404);
    }

    if (!tenant.paymentOnlineEnabled) {
      throw new PaymentLinkError(
        "PAYMENT_DISABLED",
        "Le paiement en ligne n'est pas activé pour ce locataire.",
        400
      );
    }

    if (tenant.paymentCurrency.toLowerCase() !== "eur") {
      throw new PaymentLinkError(
        "PAYMENT_CURRENCY_UNSUPPORTED",
        "Devise non prise en charge pour le paiement.",
        400
      );
    }

    if (!tenant.stripeAccountId) {
      throw new PaymentLinkError(
        "STRIPE_NOT_CONNECTED",
        "Aucun compte Stripe Connect n'est associé à ce locataire.",
        400
      );
    }

    if (!tenant.stripeChargesEnabled) {
      throw new PaymentLinkError(
        "ONBOARDING_INCOMPLETE",
        "Le compte Stripe n'est pas prêt à encaisser (charges non activées).",
        400
      );
    }

    const lead = await prisma.leadRequest.findFirst({
      where: { id: input.leadRequestId, tenantId: input.tenantId },
    });
    if (!lead) {
      throw new PaymentLinkError("NOT_FOUND", "Demande introuvable.", 404);
    }

    if (LEAD_STATUSES_BLOCKED_FOR_PAYMENT.includes(lead.status)) {
      throw new PaymentLinkError(
        "LEAD_NOT_PAYABLE",
        "Cette demande ne peut pas recevoir de lien de paiement dans son état actuel.",
        400
      );
    }

    if (input.forceNewCheckoutSession) {
      await prisma.payment.updateMany({
        where: {
          tenantId: input.tenantId,
          leadRequestId: input.leadRequestId,
          status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
        },
        data: { status: PaymentStatus.CANCELLED },
      });
    }

    const applicationFeeAmount = tenant.platformApplicationFeeAmount;
    const { totalCents, chargeCents } = resolveLeadPaymentAmountCents(lead, input.mode, tenant);
    validateChargeAndFee(chargeCents, applicationFeeAmount);

    const paidExists = await prisma.payment.findFirst({
      where: {
        tenantId: input.tenantId,
        leadRequestId: input.leadRequestId,
        status: PaymentStatus.PAID,
      },
    });
    if (paidExists) {
      throw new PaymentLinkError(
        "PAYMENT_ALREADY_PAID",
        "Un paiement confirmé existe déjà pour cette demande.",
        409
      );
    }

    const now = new Date();
    const openLink = await prisma.payment.findFirst({
      where: {
        tenantId: input.tenantId,
        leadRequestId: input.leadRequestId,
        status: PaymentStatus.LINK_SENT,
        stripePaymentLinkUrl: { not: null },
        OR: [{ checkoutExpiresAt: null }, { checkoutExpiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      openLink?.stripePaymentLinkUrl &&
      (!openLink.checkoutExpiresAt || openLink.checkoutExpiresAt > now)
    ) {
      return {
        paymentId: openLink.id,
        checkoutUrl: openLink.stripePaymentLinkUrl,
        paymentStatus: openLink.status,
        amount: openLink.amount,
        currency: openLink.currency,
        applicationFeeAmount: openLink.applicationFeeAmount,
        created: false,
        reusedExistingCheckout: true,
      };
    }

    const metadataSnapshot: Prisma.InputJsonValue = {
      leadRequestId: input.leadRequestId,
      mode: input.mode,
      totalAmountCents: totalCents,
      ...(input.message ? { message: input.message.slice(0, 1000) } : {}),
    };

    await prisma.payment.updateMany({
      where: {
        tenantId: input.tenantId,
        leadRequestId: input.leadRequestId,
        status: PaymentStatus.PENDING,
      },
      data: { status: PaymentStatus.CANCELLED },
    });

    const payment = await prisma.payment.create({
      data: {
        tenantId: input.tenantId,
        leadRequestId: input.leadRequestId,
        status: PaymentStatus.PENDING,
        provider: PaymentProvider.STRIPE,
        mode: input.mode,
        amount: chargeCents,
        currency: "eur",
        applicationFeeAmount,
        stripeAccountId: tenant.stripeAccountId,
        metadata: metadataSnapshot,
      },
    });

    const stripe = requireStripe();
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "eur",
                unit_amount: chargeCents,
                product_data: {
                  name: `Réservation VTC — demande ${lead.id.slice(0, 8)}`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            tenantId: input.tenantId,
            leadRequestId: input.leadRequestId,
            paymentId: payment.id,
            paymentMode: input.mode,
          },
          payment_intent_data: {
            application_fee_amount: applicationFeeAmount,
            metadata: {
              tenantId: input.tenantId,
              leadRequestId: input.leadRequestId,
              paymentId: payment.id,
              paymentMode: input.mode,
            },
          },
        },
        { stripeAccount: tenant.stripeAccountId }
      );

      const piRaw = session.payment_intent;
      const paymentIntentId =
        typeof piRaw === "string" ? piRaw : piRaw && typeof piRaw === "object" && "id" in piRaw
          ? String((piRaw as { id: string }).id)
          : null;

      const checkoutExpiresAt =
        typeof session.expires_at === "number"
          ? new Date(session.expires_at * 1000)
          : null;

      const checkoutUrl = session.url;
      if (!checkoutUrl) {
        throw new PaymentLinkError(
          "STRIPE_ERROR",
          "Session Checkout créée sans URL.",
          502
        );
      }

      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.LINK_SENT,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            stripePaymentLinkUrl: checkoutUrl,
            checkoutExpiresAt,
          },
        }),
        prisma.leadRequest.update({
          where: { id: lead.id },
          data: { paymentStatus: LeadPaymentStatus.LINK_SENT },
        }),
      ]);

      void trackPlatformEvent({
        tenantId: input.tenantId,
        type: "payment_checkout_created",
        category: "stripe",
        path: "/api/pro/stripe",
        metadata: {
          paymentId: payment.id,
          leadRequestId: input.leadRequestId,
          mode: input.mode,
          amountCents: chargeCents,
          applicationFeeAmountCents: applicationFeeAmount,
        },
      });

      return {
        paymentId: payment.id,
        checkoutUrl,
        paymentStatus: PaymentStatus.LINK_SENT,
        amount: chargeCents,
        currency: "eur",
        applicationFeeAmount,
        created: true,
        reusedExistingCheckout: false,
      };
    } catch (e) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
        },
      });
      if (e instanceof PaymentLinkError) throw e;
      throw new PaymentLinkError(
        "STRIPE_ERROR",
        "Erreur lors de la création de la session de paiement Stripe.",
        502
      );
    }
  }
}
