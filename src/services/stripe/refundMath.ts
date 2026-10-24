/**
 * Calculs purs (centimes) pour les remboursements Stripe — aucune dépendance Stripe/DB.
 * Convention : tous les montants sont des entiers en centimes.
 */

export type RefundLike = {
  amount: number;
  status: "PENDING" | "REQUIRES_ACTION" | "SUCCEEDED" | "FAILED" | "CANCELED";
};

export type PaymentRefundTotals = {
  succeeded: number;
  /** Remboursements demandés mais pas encore confirmés par Stripe (réservent le solde remboursable). */
  inFlight: number;
};

export function sumRefunds(refunds: RefundLike[]): PaymentRefundTotals {
  let succeeded = 0;
  let inFlight = 0;
  for (const r of refunds) {
    if (r.status === "SUCCEEDED") succeeded += r.amount;
    else if (r.status === "PENDING" || r.status === "REQUIRES_ACTION") inFlight += r.amount;
  }
  return { succeeded, inFlight };
}

/** Montant encore remboursable : payé − confirmé − en cours (jamais négatif). */
export function refundableCents(paidCents: number, totals: PaymentRefundTotals): number {
  return Math.max(0, paidCents - totals.succeeded - totals.inFlight);
}

/**
 * Commission plateforme restituée pour un remboursement donné.
 * Stripe (refund_application_fee=true) : intégralité si la charge est totalement remboursée,
 * sinon montant proportionnel au montant remboursé.
 *
 * @param feeTotalCents  application_fee_amount réel de la charge (lu sur Stripe)
 * @param feeRefundedCents commission déjà restituée
 * @param chargeCents    montant de la charge
 * @param alreadyRefundedCents remboursements déjà confirmés + en cours
 */
export function expectedApplicationFeeRefund(args: {
  feeTotalCents: number;
  feeRefundedCents: number;
  chargeCents: number;
  alreadyRefundedCents: number;
  refundCents: number;
}): number {
  const { feeTotalCents, feeRefundedCents, chargeCents, alreadyRefundedCents, refundCents } = args;
  if (feeTotalCents <= 0 || chargeCents <= 0 || refundCents <= 0) return 0;
  const feeLeft = Math.max(0, feeTotalCents - feeRefundedCents);
  if (alreadyRefundedCents + refundCents >= chargeCents) return feeLeft;
  const proportional = Math.round((feeTotalCents * refundCents) / chargeCents);
  return Math.min(feeLeft, proportional);
}

export type PaymentRefundState =
  | "PAID"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "REFUND_FAILED";

/**
 * Statut paiement dérivé uniquement de l'état Stripe confirmé.
 * - un remboursement en cours prime tant qu'il n'est pas confirmé ;
 * - un dernier remboursement en échec n'écrase pas un remboursement partiel déjà confirmé
 *   mais est signalé tant qu'aucun autre remboursement n'a réussi après lui.
 */
export function derivePaymentRefundState(args: {
  paidCents: number;
  totals: PaymentRefundTotals;
  latestTerminalFailure: boolean;
}): PaymentRefundState {
  const { paidCents, totals, latestTerminalFailure } = args;
  if (totals.inFlight > 0) return "REFUND_PENDING";
  if (paidCents > 0 && totals.succeeded >= paidCents) return "REFUNDED";
  if (latestTerminalFailure) return "REFUND_FAILED";
  if (totals.succeeded > 0) return "PARTIALLY_REFUNDED";
  return "PAID";
}

export type StripeRefundStatusRaw = string | null | undefined;

export function mapStripeRefundStatus(
  raw: StripeRefundStatusRaw
): "PENDING" | "REQUIRES_ACTION" | "SUCCEEDED" | "FAILED" | "CANCELED" {
  switch (raw) {
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    case "requires_action":
      return "REQUIRES_ACTION";
    case "pending":
    default:
      return "PENDING";
  }
}

export function formatEurCents(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
