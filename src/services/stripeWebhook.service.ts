import {
  LeadPaymentStatus,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { notifyPaymentConfirmedAfterWebhookTransition } from "../modules/email/paymentConfirmationMail";
import { fetchStripeReceiptUrlForPaymentIntent } from "./stripe/stripeReceiptUrl";
import { getStripeClient } from "./stripe/stripeClient";
import { trackPlatformEvent } from "../platform/telemetry.service";
import { getRefundService } from "./refundContainer";
import { notifyTenantPush } from "./push";
import { factsFromStripeAccount, resolveOnboardingEnum } from "./stripe/stripeAccountStatus";

/** Formes minimales des objets Stripe (évite les types du constructeur exporté par défaut). */
type StripeMetadata = Record<string, string> | null | undefined;

type CheckoutSessionLike = {
  id: string;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: StripeMetadata;
  payment_intent?: string | { id?: string } | null;
};

type PaymentIntentLike = {
  id: string;
  amount?: number;
  amount_received?: number | null;
  currency?: string;
  metadata?: StripeMetadata;
};

export type StripeWebhookEventLike = {
  id?: string;
  type: string;
  /** Compte connecté à l'origine de l'événement (événements Connect). */
  account?: string | null;
  data: { object: unknown };
};

function metaString(meta: StripeMetadata, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asCheckoutSession(obj: unknown): CheckoutSessionLike | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  return obj as CheckoutSessionLike;
}

function asPaymentIntent(obj: unknown): PaymentIntentLike | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  return obj as PaymentIntentLike;
}

/**
 * Met le paiement en PAID si les contrôles passent.
 * @returns true uniquement si une transition réelle vers PAID vient d’être faite (idempotence emails PR6B).
 */
async function markPaymentPaid(params: {
  paymentId: string;
  tenantId: string;
  leadRequestId: string;
  stripePaymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
}): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: {
      id: params.paymentId,
      tenantId: params.tenantId,
      leadRequestId: params.leadRequestId,
    },
  });
  if (!payment) return false;

  if (params.amountTotal !== null && params.amountTotal !== payment.amount) {
    console.error("[stripe-webhook] Écart montant session / Payment", {
      paymentId: payment.id,
      expected: payment.amount,
      got: params.amountTotal,
    });
    return false;
  }
  if (
    params.currency &&
    params.currency.toLowerCase() !== payment.currency.toLowerCase()
  ) {
    console.error("[stripe-webhook] Écart devise session / Payment", {
      paymentId: payment.id,
    });
    return false;
  }

  if (payment.status === PaymentStatus.PAID) {
    if (params.stripePaymentIntentId && !payment.stripePaymentIntentId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { stripePaymentIntentId: params.stripePaymentIntentId },
      });
    }
    return false;
  }

  const updated = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
    },
    data: {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      ...(params.stripePaymentIntentId
        ? { stripePaymentIntentId: params.stripePaymentIntentId }
        : {}),
    },
  });

  if (updated.count === 0) return false;

  await prisma.leadRequest.updateMany({
    where: { id: params.leadRequestId, tenantId: params.tenantId },
    data: { paymentStatus: LeadPaymentStatus.PAID },
  });

  void trackPlatformEvent({
    tenantId: params.tenantId,
    type: "payment_succeeded",
    category: "stripe",
    path: "/api/stripe/webhook",
    metadata: {
      paymentId: params.paymentId,
      leadRequestId: params.leadRequestId,
      amountCents: params.amountTotal ?? undefined,
      currency: params.currency ?? undefined,
    },
  });

  return true;
}

async function persistReceiptThenNotify(params: {
  paymentId: string;
  tenantId: string;
  leadRequestId: string;
  stripePaymentIntentId: string | null;
}): Promise<void> {
  if (params.stripePaymentIntentId) {
    const stripe = getStripeClient();
    const row = await prisma.payment.findFirst({
      where: { id: params.paymentId, tenantId: params.tenantId },
      select: { stripeAccountId: true, stripeReceiptUrl: true },
    });
    if (stripe && row?.stripeAccountId && !row.stripeReceiptUrl) {
      const url = await fetchStripeReceiptUrlForPaymentIntent(
        stripe,
        row.stripeAccountId,
        params.stripePaymentIntentId
      );
      if (url) {
        await prisma.payment.updateMany({
          where: { id: params.paymentId, tenantId: params.tenantId },
          data: { stripeReceiptUrl: url },
        });
      }
    }
  }
  await notifyPaymentConfirmedAfterWebhookTransition({
    tenantId: params.tenantId,
    leadRequestId: params.leadRequestId,
    paymentId: params.paymentId,
  });
}

async function handleCheckoutSessionCompleted(
  session: CheckoutSessionLike
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const tenantId = metaString(session.metadata, "tenantId");
  const leadRequestId = metaString(session.metadata, "leadRequestId");
  const paymentId = metaString(session.metadata, "paymentId");
  if (!tenantId || !leadRequestId || !paymentId) return;

  const piRaw = session.payment_intent;
  const stripePaymentIntentId =
    typeof piRaw === "string"
      ? piRaw
      : piRaw && typeof piRaw === "object" && "id" in piRaw
        ? String((piRaw as { id: string }).id)
        : null;

  const transitioned = await markPaymentPaid({
    paymentId,
    tenantId,
    leadRequestId,
    stripePaymentIntentId,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
  });

  if (transitioned) {
    // Transition réelle uniquement : un événement Stripe rejoué ne renotifie pas.
    notifyTenantPush(tenantId, "payment_confirmed", leadRequestId);
    await persistReceiptThenNotify({
      paymentId,
      tenantId,
      leadRequestId,
      stripePaymentIntentId,
    });
  }
}

async function handleCheckoutSessionExpired(
  session: CheckoutSessionLike
): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { stripeCheckoutSessionId: session.id },
  });
  if (!payment || payment.status === PaymentStatus.PAID) return;

  const result = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
    },
    data: { status: PaymentStatus.EXPIRED },
  });
  if (result.count === 0) return;

  await prisma.leadRequest.updateMany({
    where: { id: payment.leadRequestId, tenantId: payment.tenantId },
    data: { paymentStatus: LeadPaymentStatus.EXPIRED },
  });
}

async function handlePaymentIntentSucceeded(
  pi: PaymentIntentLike
): Promise<void> {
  const paymentId = metaString(pi.metadata, "paymentId");
  const tenantId = metaString(pi.metadata, "tenantId");
  const leadRequestId = metaString(pi.metadata, "leadRequestId");
  if (!paymentId || !tenantId || !leadRequestId) return;

  const transitioned = await markPaymentPaid({
    paymentId,
    tenantId,
    leadRequestId,
    stripePaymentIntentId: pi.id,
    amountTotal: pi.amount_received ?? pi.amount ?? null,
    currency: typeof pi.currency === "string" ? pi.currency : null,
  });

  if (transitioned) {
    // Transition réelle uniquement : un événement Stripe rejoué ne renotifie pas.
    notifyTenantPush(tenantId, "payment_confirmed", leadRequestId);
    await persistReceiptThenNotify({
      paymentId,
      tenantId,
      leadRequestId,
      stripePaymentIntentId: pi.id,
    });
  }
}

async function handlePaymentIntentFailed(pi: PaymentIntentLike): Promise<void> {
  const paymentIdMeta = metaString(pi.metadata, "paymentId");
  const payment =
    (await prisma.payment.findFirst({ where: { stripePaymentIntentId: pi.id } })) ??
    (paymentIdMeta
      ? await prisma.payment.findFirst({ where: { id: paymentIdMeta } })
      : null);

  if (!payment || payment.status === PaymentStatus.PAID) return;

  const result = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
    },
    data: {
      status: PaymentStatus.FAILED,
      failedAt: new Date(),
      ...(payment.stripePaymentIntentId ? {} : { stripePaymentIntentId: pi.id }),
    },
  });
  if (result.count === 0) return;

  await prisma.leadRequest.updateMany({
    where: { id: payment.leadRequestId, tenantId: payment.tenantId },
    data: { paymentStatus: LeadPaymentStatus.FAILED },
  });

  void trackPlatformEvent({
    tenantId: payment.tenantId,
    type: "payment_failed",
    category: "stripe",
    path: "/api/stripe/webhook",
    metadata: {
      paymentId: payment.id,
      leadRequestId: payment.leadRequestId,
      paymentIntentId: pi.id,
    },
  });
}

function idOf(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string") {
    return (v as { id: string }).id;
  }
  return null;
}

/** account.updated : aligne les drapeaux Stripe du tenant sur l'état réel du compte. */
async function handleAccountUpdated(event: StripeWebhookEventLike): Promise<void> {
  const obj = event.data.object as Record<string, unknown> | null;
  const accountId = idOf(obj) ?? event.account ?? null;
  if (!accountId || !obj) return;
  if (event.account && event.account !== accountId) return; // incohérence : on ignore
  const tenant = await prisma.tenant.findUnique({ where: { stripeAccountId: accountId }, select: { id: true } });
  if (!tenant) return;
  const facts = factsFromStripeAccount(obj as Parameters<typeof factsFromStripeAccount>[0]);
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeChargesEnabled: facts.chargesEnabled,
      stripePayoutsEnabled: facts.payoutsEnabled,
      stripeDetailsSubmitted: facts.detailsSubmitted,
      stripeOnboardingStatus: resolveOnboardingEnum(facts),
    },
  });
}

/**
 * Événements de remboursement : on ne se fie pas à l'ordre d'arrivée ni au contenu de l'événement.
 * Le paiement est retrouvé (compte connecté + PaymentIntent), puis ses remboursements sont relus sur Stripe.
 */
async function reconcileRefundsForIntent(event: StripeWebhookEventLike, paymentIntentId: string | null): Promise<void> {
  if (!paymentIntentId) return;
  let accountId = event.account ?? null;
  if (!accountId) {
    const p = await prisma.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { stripeAccountId: true },
    });
    accountId = p?.stripeAccountId ?? null;
  }
  if (!accountId) return;
  await getRefundService().reconcileByPaymentIntent({ accountId, paymentIntentId });
}

async function handleApplicationFeeRefunded(event: StripeWebhookEventLike): Promise<void> {
  const fee = event.data.object as { charge?: unknown; account?: unknown } | null;
  const chargeId = idOf(fee?.charge);
  if (!chargeId) return;
  const payment = await prisma.payment.findFirst({
    where: { stripeChargeId: chargeId },
    select: { stripePaymentIntentId: true, stripeAccountId: true },
  });
  if (payment?.stripePaymentIntentId) {
    await getRefundService().reconcileByPaymentIntent({
      accountId: payment.stripeAccountId,
      paymentIntentId: payment.stripePaymentIntentId,
    });
    return;
  }
  const accountId = idOf(fee?.account) ?? event.account ?? null;
  const stripe = getStripeClient();
  if (!stripe || !accountId) return;
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId });
  await reconcileRefundsForIntent({ ...event, account: accountId }, idOf(charge.payment_intent));
}

export async function processStripeWebhookEvent(
  event: StripeWebhookEventLike
): Promise<void> {
  switch (event.type) {
    case "account.updated":
      await handleAccountUpdated(event);
      break;
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
    case "charge.refund.updated": {
      const refund = event.data.object as { payment_intent?: unknown } | null;
      await reconcileRefundsForIntent(event, idOf(refund?.payment_intent));
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as { payment_intent?: unknown } | null;
      await reconcileRefundsForIntent(event, idOf(charge?.payment_intent));
      break;
    }
    case "application_fee.refunded":
      await handleApplicationFeeRefunded(event);
      break;
    case "checkout.session.completed": {
      const session = asCheckoutSession(event.data.object);
      if (session) await handleCheckoutSessionCompleted(session);
      break;
    }
    case "checkout.session.expired": {
      const session = asCheckoutSession(event.data.object);
      if (session) await handleCheckoutSessionExpired(session);
      break;
    }
    case "payment_intent.succeeded": {
      const pi = asPaymentIntent(event.data.object);
      if (pi) await handlePaymentIntentSucceeded(pi);
      break;
    }
    case "payment_intent.payment_failed": {
      const pi = asPaymentIntent(event.data.object);
      if (pi) await handlePaymentIntentFailed(pi);
      break;
    }
    default:
      break;
  }
}
