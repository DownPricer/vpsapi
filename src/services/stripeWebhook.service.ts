import {
  LeadPaymentStatus,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { notifyPaymentConfirmedAfterWebhookTransition } from "../modules/email/paymentConfirmationMail";

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
  type: string;
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

  return true;
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
    await notifyPaymentConfirmedAfterWebhookTransition({
      tenantId,
      leadRequestId,
      paymentId,
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
    await notifyPaymentConfirmedAfterWebhookTransition({
      tenantId,
      leadRequestId,
      paymentId,
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
}

export async function processStripeWebhookEvent(
  event: StripeWebhookEventLike
): Promise<void> {
  switch (event.type) {
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
