import Stripe from "stripe";

type StripeClient = InstanceType<typeof Stripe>;

/**
 * Récupère l’URL du reçu Stripe (Charge.receipt_url) pour un paiement Connect.
 */
export async function fetchStripeReceiptUrlForPaymentIntent(
  stripe: StripeClient,
  stripeConnectAccountId: string,
  paymentIntentId: string
): Promise<string | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, undefined, {
      stripeAccount: stripeConnectAccountId,
    });
    const lc = pi.latest_charge;
    const chargeId =
      typeof lc === "string"
        ? lc
        : lc && typeof lc === "object" && lc !== null && "id" in lc
          ? String((lc as { id: string }).id)
          : null;
    if (!chargeId) return null;
    const charge = await stripe.charges.retrieve(chargeId, undefined, {
      stripeAccount: stripeConnectAccountId,
    });
    const url = charge.receipt_url;
    return typeof url === "string" && url.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}
