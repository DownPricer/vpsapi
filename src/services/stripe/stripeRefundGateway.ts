import { getStripeClient } from "./stripeClient";
import type { RefundStripeGateway, StripeChargeDetails, StripeRefundLite } from "./refund.types";

type StripeSdk = NonNullable<ReturnType<typeof getStripeClient>>;

function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string") {
    return (v as { id: string }).id;
  }
  return null;
}

function toLite(r: {
  id: string;
  status: string | null;
  amount: number;
  currency: string;
  payment_intent: unknown;
  charge: unknown;
  failure_reason?: string | null;
  metadata: Record<string, string> | null;
  created: number;
}): StripeRefundLite {
  return {
    id: r.id,
    status: r.status,
    amount: r.amount,
    currency: r.currency,
    paymentIntentId: idOf(r.payment_intent),
    chargeId: idOf(r.charge),
    failureReason: r.failure_reason ?? null,
    metadata: r.metadata ?? {},
    created: r.created,
  };
}

/**
 * Implémentation Stripe des remboursements en DIRECT CHARGE : toutes les requêtes ciblent le compte
 * connecté via l'en-tête `Stripe-Account` (jamais `reverse_transfer`, réservé aux destination charges).
 */
export class StripeRefundGatewayImpl implements RefundStripeGateway {
  constructor(private readonly stripe: StripeSdk) {}

  async retrieveChargeDetails(args: { paymentIntentId: string; accountId: string }): Promise<StripeChargeDetails> {
    // Une charge récupérable avec Stripe-Account = charge créée sur le compte connecté (direct charge).
    const pi = await this.stripe.paymentIntents.retrieve(
      args.paymentIntentId,
      { expand: ["latest_charge"] },
      { stripeAccount: args.accountId }
    );
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") {
      throw Object.assign(new Error("charge_missing"), { type: "StripeInvalidRequestError", code: "charge_missing" });
    }
    const transferData = (charge as { transfer_data?: unknown }).transfer_data;
    return {
      chargeId: charge.id,
      paymentIntentId: pi.id,
      amount: charge.amount,
      amountRefunded: charge.amount_refunded,
      currency: charge.currency,
      applicationFeeId: idOf(charge.application_fee),
      applicationFeeAmount: pi.application_fee_amount ?? 0,
      paid: Boolean(charge.paid) && charge.status === "succeeded",
      directCharge: transferData == null,
    };
  }

  async createRefund(args: {
    paymentIntentId: string;
    accountId: string;
    amount: number;
    refundApplicationFee: boolean;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<StripeRefundLite> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: args.paymentIntentId,
        amount: args.amount,
        reason: "requested_by_customer",
        ...(args.refundApplicationFee ? { refund_application_fee: true } : {}),
        metadata: args.metadata,
      },
      { stripeAccount: args.accountId, idempotencyKey: args.idempotencyKey }
    );
    return toLite(refund);
  }

  async listRefunds(args: { paymentIntentId: string; accountId: string }): Promise<StripeRefundLite[]> {
    const out: StripeRefundLite[] = [];
    const list = this.stripe.refunds.list(
      { payment_intent: args.paymentIntentId, limit: 100 },
      { stripeAccount: args.accountId }
    );
    for await (const r of list) {
      out.push(toLite(r));
      if (out.length >= 500) break;
    }
    return out;
  }

  async retrieveApplicationFeeRefunded(applicationFeeId: string): Promise<number> {
    // Les ApplicationFee vivent sur le compte plateforme (pas de Stripe-Account).
    const fee = await this.stripe.applicationFees.retrieve(applicationFeeId);
    return fee.amount_refunded;
  }
}

export function getRefundStripeGateway(): RefundStripeGateway | null {
  const stripe = getStripeClient();
  return stripe ? new StripeRefundGatewayImpl(stripe) : null;
}
