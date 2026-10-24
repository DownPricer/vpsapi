import { PaymentStatus } from "@prisma/client";

/**
 * Paiements réellement encaissés par Stripe, qu'ils aient été ensuite remboursés ou non.
 * Les statistiques « brutes » (CA payé, commissions encaissées) s'appuient dessus pour rester stables
 * quand un paiement passe en remboursé : les remboursements sont comptés à part.
 */
export const COLLECTED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUND_FAILED,
  PaymentStatus.REFUNDED,
];

export function isCollectedStatus(status: string): boolean {
  return (COLLECTED_PAYMENT_STATUSES as string[]).includes(status);
}
