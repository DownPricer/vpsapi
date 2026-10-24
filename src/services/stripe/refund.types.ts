import type { LeadPaymentStatus, PaymentRefund, PaymentStatus, RefundInitiator, RefundStatus } from "@prisma/client";
import type { PaymentRefundState, PaymentRefundTotals } from "./refundMath";

export type RefundRecord = PaymentRefund;

export type PaymentRecord = {
  id: string;
  tenantId: string;
  leadRequestId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  applicationFeeAmount: number;
  /** Compte connecté enregistré sur le paiement (acct_...). */
  stripeAccountId: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeApplicationFeeId: string | null;
  refundedAmount: number;
  applicationFeeRefundedAmount: number;
  /** Compte connecté actuellement associé au tenant (doit être identique à stripeAccountId). */
  tenantStripeAccountId: string | null;
};

export type StripeChargeDetails = {
  chargeId: string;
  paymentIntentId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  applicationFeeId: string | null;
  applicationFeeAmount: number;
  paid: boolean;
  /** true si la charge existe sur le compte connecté (direct charge). */
  directCharge: boolean;
};

export type StripeRefundLite = {
  id: string;
  status: string | null;
  amount: number;
  currency: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  failureReason: string | null;
  metadata: Record<string, string>;
  created: number;
};

/** Frontière Stripe : toute l'utilisation du SDK pour les remboursements passe par ici. */
export interface RefundStripeGateway {
  retrieveChargeDetails(args: { paymentIntentId: string; accountId: string }): Promise<StripeChargeDetails>;
  createRefund(args: {
    paymentIntentId: string;
    accountId: string;
    amount: number;
    refundApplicationFee: boolean;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<StripeRefundLite>;
  listRefunds(args: { paymentIntentId: string; accountId: string }): Promise<StripeRefundLite[]>;
  /** Montant total de commission plateforme restituée (ApplicationFee.amount_refunded). */
  retrieveApplicationFeeRefunded(applicationFeeId: string): Promise<number>;
}

export type ReserveInput = {
  tenantId: string;
  paymentId: string;
  clientRequestId: string;
  idempotencyKey: string;
  amount: number;
  reason: string | null;
  reasonNote: string | null;
  initiatedBy: RefundInitiator;
  initiatedByUserId: string | null;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  stripeAccountId: string;
  /** Appelé sous verrou avec les totaux fiables pour calculer la commission attendue. */
  expectedFee: (totals: PaymentRefundTotals) => number;
};

export type ReserveResult =
  | { kind: "created"; refund: RefundRecord }
  | { kind: "existing"; refund: RefundRecord }
  | {
      kind: "rejected";
      code: "AMOUNT_EXCEEDS_REFUNDABLE" | "REFUND_IN_PROGRESS" | "PAYMENT_NOT_REFUNDABLE";
      refundable: number;
    };

export type PaymentAggregatePatch = {
  status: PaymentStatus;
  leadPaymentStatus: LeadPaymentStatus;
  refundedAmount: number;
  applicationFeeRefundedAmount: number;
  refundedAt: Date | null;
  refundsSyncedAt: Date;
};

export type NotificationKind = "initiated" | "succeeded" | "failed";

export interface RefundStore {
  getPayment(tenantId: string, paymentId: string): Promise<PaymentRecord | null>;
  getPaymentByIntent(accountId: string, paymentIntentId: string): Promise<PaymentRecord | null>;
  setPaymentCharge(paymentId: string, charge: { chargeId: string; applicationFeeId: string | null }): Promise<void>;
  reserveRefund(input: ReserveInput): Promise<ReserveResult>;
  findRefundByStripeId(stripeRefundId: string): Promise<RefundRecord | null>;
  findRefundById(refundId: string): Promise<RefundRecord | null>;
  createExternalRefund(input: {
    tenantId: string;
    paymentId: string;
    leadRequestId: string;
    stripeRefundId: string;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    stripeAccountId: string;
    amount: number;
    currency: string;
    status: RefundStatus;
    failureReason: string | null;
  }): Promise<RefundRecord>;
  updateRefund(
    refundId: string,
    patch: Partial<
      Pick<
        RefundRecord,
        | "status"
        | "stripeRefundId"
        | "stripeChargeId"
        | "failureReason"
        | "applicationFeeRefunded"
        | "lastSyncedAt"
      >
    >
  ): Promise<RefundRecord>;
  listRefunds(paymentId: string): Promise<RefundRecord[]>;
  savePaymentAggregate(paymentId: string, patch: PaymentAggregatePatch): Promise<void>;
  /** Marque l'envoi d'une notification ; true uniquement pour le premier appelant (atomique). */
  claimNotification(refundId: string, kind: NotificationKind): Promise<boolean>;
}

export type RefundNotifyContext = {
  kind: NotificationKind;
  payment: PaymentRecord;
  refund: RefundRecord;
  /** Total confirmé après cette opération. */
  refundedTotal: number;
  fullyRefunded: boolean;
};

export interface RefundNotifier {
  send(ctx: RefundNotifyContext): Promise<void>;
}

export type RefundPreview = {
  paymentId: string;
  currency: string;
  paidCents: number;
  refundedCents: number;
  inFlightCents: number;
  refundableCents: number;
  requestedCents: number;
  platformFeeTotalCents: number;
  platformFeeRefundedCents: number;
  /** Commission plateforme restituée pour le montant demandé. */
  platformFeeRefundCents: number;
  /** Ce que le client reçoit. */
  customerReceivesCents: number;
  /** Impact estimé sur le solde Stripe du chauffeur (débit net). */
  driverNetDebitCents: number;
  paymentStatus: PaymentStatus;
  state: PaymentRefundState;
};
