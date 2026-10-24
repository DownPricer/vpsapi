import { LeadPaymentStatus, PaymentStatus, RefundInitiator, RefundStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  derivePaymentRefundState,
  expectedApplicationFeeRefund,
  mapStripeRefundStatus,
  refundableCents,
  sumRefunds,
  type PaymentRefundState,
} from "./refundMath";
import type {
  NotificationKind,
  PaymentRecord,
  RefundNotifier,
  RefundPreview,
  RefundRecord,
  RefundStore,
  RefundStripeGateway,
  StripeChargeDetails,
  StripeRefundLite,
} from "./refund.types";

export class RefundServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "RefundServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const REFUNDABLE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_FAILED,
];

export const REFUND_REASONS = [
  "driver_cancelled",
  "customer_request",
  "service_issue",
  "duplicate",
  "goodwill",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

function isTerminal(status: RefundStatus): boolean {
  return status === RefundStatus.SUCCEEDED || status === RefundStatus.FAILED || status === RefundStatus.CANCELED;
}

type StripeErrorLike = { type?: string; statusCode?: number; code?: string; message?: string };

/** Une erreur « définitive » garantit que Stripe n'a PAS créé de remboursement. */
export function isDefinitiveStripeError(e: unknown): boolean {
  const err = e as StripeErrorLike | null;
  if (!err || typeof err !== "object") return false;
  if (
    err.type === "StripeInvalidRequestError" ||
    err.type === "StripeCardError" ||
    err.type === "StripePermissionError" ||
    err.type === "StripeAuthenticationError"
  ) {
    return true;
  }
  const sc = err.statusCode;
  return typeof sc === "number" && sc >= 400 && sc < 500 && sc !== 409 && sc !== 429;
}

function stripeFailureMessage(code: string | undefined): string {
  switch (code) {
    case "charge_already_refunded":
      return "Ce paiement est déjà entièrement remboursé sur Stripe.";
    case "balance_insufficient":
    case "insufficient_funds":
      return "Le solde du compte Stripe du chauffeur est insuffisant pour ce remboursement.";
    case "charge_disputed":
      return "Ce paiement fait l'objet d'un litige Stripe : remboursement impossible.";
    case "amount_too_large":
      return "Le montant dépasse le solde remboursable sur Stripe.";
    default:
      return "Stripe a refusé le remboursement.";
  }
}

export type RequestRefundInput = {
  tenantId: string;
  paymentId: string;
  /** Centimes ; ignoré si full === true. */
  amountCents?: number;
  full?: boolean;
  reason: RefundReason | string | null;
  note?: string | null;
  clientRequestId: string;
  initiatedBy?: RefundInitiator;
  initiatedByUserId?: string | null;
};

export type RequestRefundResult = {
  refund: RefundRecord;
  payment: PaymentRecord;
  /** true : la demande existait déjà (double clic / nouvel essai) et aucun nouvel appel n'a été nécessaire. */
  deduplicated: boolean;
  /** true : Stripe a confirmé le remboursement (status succeeded). */
  confirmed: boolean;
  paymentState: PaymentRefundState;
};

export class RefundService {
  constructor(
    private readonly deps: {
      store: RefundStore;
      gateway: () => RefundStripeGateway | null;
      notifier: RefundNotifier;
    }
  ) {}

  private requireGateway(): RefundStripeGateway {
    const g = this.deps.gateway();
    if (!g) throw new RefundServiceError("STRIPE_NOT_CONFIGURED", "Stripe n'est pas configuré sur l'API.", 503);
    return g;
  }

  private async loadPayment(tenantId: string, paymentId: string): Promise<PaymentRecord> {
    const payment = await this.deps.store.getPayment(tenantId, paymentId);
    // Même réponse pour « inexistant » et « autre tenant » : pas d'énumération entre tenants.
    if (!payment || payment.tenantId !== tenantId) {
      throw new RefundServiceError("PAYMENT_NOT_FOUND", "Paiement introuvable.", 404);
    }
    return payment;
  }

  private assertAccountConsistent(payment: PaymentRecord): void {
    if (!payment.tenantStripeAccountId || payment.tenantStripeAccountId !== payment.stripeAccountId) {
      throw new RefundServiceError(
        "STRIPE_ACCOUNT_MISMATCH",
        "Le compte Stripe du paiement ne correspond plus à celui de votre espace. Contactez le support.",
        409
      );
    }
    if (!payment.stripePaymentIntentId) {
      throw new RefundServiceError(
        "PAYMENT_NOT_REFUNDABLE",
        "Ce paiement n'a pas d'identifiant Stripe : remboursement impossible.",
        409
      );
    }
  }

  private async ensureCharge(payment: PaymentRecord): Promise<StripeChargeDetails> {
    const gateway = this.requireGateway();
    let charge: StripeChargeDetails;
    try {
      charge = await gateway.retrieveChargeDetails({
        paymentIntentId: payment.stripePaymentIntentId as string,
        accountId: payment.stripeAccountId,
      });
    } catch (e) {
      if (e instanceof RefundServiceError) throw e;
      if (isDefinitiveStripeError(e)) {
        throw new RefundServiceError(
          "UNSUPPORTED_CHARGE_TYPE",
          "Ce paiement n'est pas une charge directe du compte Stripe du chauffeur : remboursement automatique impossible.",
          409
        );
      }
      throw new RefundServiceError("STRIPE_UNREACHABLE", "Stripe est momentanément injoignable. Réessayez.", 502);
    }
    if (!charge.directCharge) {
      throw new RefundServiceError(
        "UNSUPPORTED_CHARGE_TYPE",
        "Ce paiement n'est pas une charge directe du compte Stripe du chauffeur : remboursement automatique impossible.",
        409
      );
    }
    if (!charge.paid) {
      throw new RefundServiceError("PAYMENT_NOT_REFUNDABLE", "Le paiement n'est pas encaissé sur Stripe.", 409);
    }
    if (charge.amount !== payment.amount || charge.currency.toLowerCase() !== payment.currency.toLowerCase()) {
      throw new RefundServiceError(
        "PAYMENT_AMOUNT_MISMATCH",
        "Le montant Stripe diffère du montant enregistré : vérification manuelle nécessaire.",
        409
      );
    }
    if (payment.stripeChargeId !== charge.chargeId || payment.stripeApplicationFeeId !== charge.applicationFeeId) {
      await this.deps.store.setPaymentCharge(payment.id, {
        chargeId: charge.chargeId,
        applicationFeeId: charge.applicationFeeId,
      });
    }
    return charge;
  }

  /** Aperçu chiffré avant confirmation (aucune écriture Stripe). */
  async preview(args: { tenantId: string; paymentId: string; amountCents?: number }): Promise<RefundPreview> {
    let payment = await this.loadPayment(args.tenantId, args.paymentId);
    this.assertAccountConsistent(payment);
    try {
      await this.reconcile(payment);
      payment = await this.loadPayment(args.tenantId, args.paymentId);
    } catch {
      // Aperçu : on retombe sur les données locales si Stripe est injoignable.
    }
    const refunds = await this.deps.store.listRefunds(payment.id);
    const totals = sumRefunds(refunds);
    const refundable = refundableCents(payment.amount, totals);
    const requested = args.amountCents ?? refundable;

    let feeTotal = payment.applicationFeeAmount;
    try {
      const charge = await this.ensureCharge(payment);
      feeTotal = charge.applicationFeeAmount;
    } catch {
      // idem : valeurs locales
    }
    const feeRefund = expectedApplicationFeeRefund({
      feeTotalCents: feeTotal,
      feeRefundedCents: payment.applicationFeeRefundedAmount,
      chargeCents: payment.amount,
      alreadyRefundedCents: totals.succeeded + totals.inFlight,
      refundCents: Math.min(requested, refundable),
    });
    const effective = Math.min(requested, refundable);
    return {
      paymentId: payment.id,
      currency: payment.currency,
      paidCents: payment.amount,
      refundedCents: totals.succeeded,
      inFlightCents: totals.inFlight,
      refundableCents: refundable,
      requestedCents: effective,
      platformFeeTotalCents: feeTotal,
      platformFeeRefundedCents: payment.applicationFeeRefundedAmount,
      platformFeeRefundCents: feeRefund,
      customerReceivesCents: effective,
      driverNetDebitCents: Math.max(0, effective - feeRefund),
      paymentStatus: payment.status,
      state: derivePaymentRefundState({
        paidCents: payment.amount,
        totals,
        latestTerminalFailure: payment.status === PaymentStatus.REFUND_FAILED,
      }),
    };
  }

  async requestRefund(input: RequestRefundInput): Promise<RequestRefundResult> {
    if (!input.clientRequestId || input.clientRequestId.length < 8 || input.clientRequestId.length > 100) {
      throw new RefundServiceError("VALIDATION_ERROR", "Identifiant de demande invalide.", 400);
    }
    let payment = await this.loadPayment(input.tenantId, input.paymentId);
    this.assertAccountConsistent(payment);

    // Demande déjà enregistrée ? (double clic / nouvel essai après erreur réseau) → on rejoue sans recalcul.
    const existingRefunds = await this.deps.store.listRefunds(payment.id);
    const already = existingRefunds.find((r) => r.clientRequestId === input.clientRequestId);
    if (already && (already.stripeRefundId || isTerminal(already.status))) {
      await this.reconcile(payment).catch(() => undefined);
      payment = await this.loadPayment(input.tenantId, input.paymentId);
      const refund = (await this.deps.store.findRefundById(already.id)) ?? already;
      return this.buildResult(payment, refund, true);
    }

    if (!REFUNDABLE_PAYMENT_STATUSES.includes(payment.status) && !already) {
      throw new RefundServiceError(
        "PAYMENT_NOT_REFUNDABLE",
        payment.status === PaymentStatus.REFUND_PENDING
          ? "Un remboursement est déjà en cours pour ce paiement."
          : "Seul un paiement encaissé peut être remboursé.",
        409
      );
    }

    const charge = await this.ensureCharge(payment);
    // Rattrape les remboursements faits hors de la plateforme (dashboard Stripe) avant de calculer le solde,
    // et rattache à leur ligne locale les remboursements créés lors d'un essai précédent à résultat incertain.
    await this.reconcile(payment, charge).catch(() => undefined);
    payment = await this.loadPayment(input.tenantId, input.paymentId);
    if (already) {
      const fresh = await this.deps.store.findRefundById(already.id);
      if (fresh && (fresh.stripeRefundId || isTerminal(fresh.status))) {
        return this.buildResult(payment, fresh, true);
      }
    }

    const stripeRemaining = Math.max(0, charge.amount - charge.amountRefunded);
    const refundsNow = await this.deps.store.listRefunds(payment.id);
    const totalsNow = sumRefunds(refundsNow);
    const localRefundable = refundableCents(payment.amount, totalsNow);
    const full = input.full === true;
    const amount = full ? Math.min(localRefundable, stripeRemaining) : Math.trunc(input.amountCents ?? 0);

    if (!already) {
      if (!Number.isFinite(amount) || amount < 1) {
        throw new RefundServiceError("VALIDATION_ERROR", "Montant de remboursement invalide.", 400);
      }
      if (amount > stripeRemaining || amount > localRefundable) {
        throw new RefundServiceError(
          "AMOUNT_EXCEEDS_REFUNDABLE",
          "Le montant dépasse le solde remboursable de ce paiement.",
          409,
          { refundableCents: Math.min(stripeRemaining, localRefundable) }
        );
      }
    }

    const reserved = already
      ? ({ kind: "existing", refund: already } as const)
      : await this.deps.store.reserveRefund({
          tenantId: payment.tenantId,
          paymentId: payment.id,
          clientRequestId: input.clientRequestId,
          idempotencyKey: `vtc-refund-${randomUUID()}`,
          amount,
          reason: input.reason ?? null,
          reasonNote: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
          initiatedBy: input.initiatedBy ?? RefundInitiator.OPERATOR,
          initiatedByUserId: input.initiatedByUserId ?? null,
          stripePaymentIntentId: payment.stripePaymentIntentId as string,
          stripeChargeId: charge.chargeId,
          stripeAccountId: payment.stripeAccountId,
          expectedFee: (totals) =>
            expectedApplicationFeeRefund({
              feeTotalCents: charge.applicationFeeAmount,
              feeRefundedCents: payment.applicationFeeRefundedAmount,
              chargeCents: payment.amount,
              alreadyRefundedCents: totals.succeeded + totals.inFlight,
              refundCents: amount,
            }),
        });

    if (reserved.kind === "rejected") {
      const msg =
        reserved.code === "REFUND_IN_PROGRESS"
          ? "Un remboursement est déjà en cours pour ce paiement. Attendez sa confirmation."
          : reserved.code === "AMOUNT_EXCEEDS_REFUNDABLE"
            ? "Le montant dépasse le solde remboursable de ce paiement."
            : "Ce paiement ne peut pas être remboursé dans son état actuel.";
      throw new RefundServiceError(reserved.code, msg, 409, { refundableCents: reserved.refundable });
    }

    let refund = reserved.refund;
    if (refund.stripeRefundId || isTerminal(refund.status)) {
      return this.buildResult(await this.loadPayment(input.tenantId, input.paymentId), refund, true);
    }
    if (reserved.kind === "created") {
      // Le paiement passe immédiatement en « remboursement en cours » (réserve le solde côté UI).
      payment = (await this.finalize(payment.id, payment.tenantId, charge)).payment;
    }

    // Appel Stripe : la clé d'idempotence est celle persistée en base (identique à chaque nouvel essai).
    const gateway = this.requireGateway();
    let stripeRefund: StripeRefundLite;
    try {
      stripeRefund = await gateway.createRefund({
        paymentIntentId: refund.stripePaymentIntentId as string,
        accountId: refund.stripeAccountId,
        amount: refund.amount,
        refundApplicationFee: charge.applicationFeeAmount > 0,
        idempotencyKey: refund.idempotencyKey,
        metadata: {
          refundRecordId: refund.id,
          paymentId: payment.id,
          tenantId: payment.tenantId,
          leadRequestId: payment.leadRequestId,
        },
      });
    } catch (e) {
      if (isDefinitiveStripeError(e)) {
        const code = (e as StripeErrorLike).code;
        refund = await this.deps.store.updateRefund(refund.id, {
          status: RefundStatus.FAILED,
          failureReason: (code ?? "stripe_rejected").slice(0, 100),
          lastSyncedAt: new Date(),
        });
        const p = await this.finalize(payment.id, payment.tenantId);
        await this.notify("failed", p.payment, refund, p.state);
        throw new RefundServiceError("STRIPE_REFUND_REJECTED", stripeFailureMessage(code), 422, {
          refundId: refund.id,
        });
      }
      // Résultat incertain : la ligne reste PENDING avec la même clé d'idempotence.
      throw new RefundServiceError(
        "STRIPE_UNCERTAIN",
        "La réponse de Stripe n'a pas pu être lue. Le remboursement n'est pas dupliqué en cas de nouvel essai : réessayez ou actualisez l'historique.",
        502,
        { refundId: refund.id, clientRequestId: refund.clientRequestId }
      );
    }

    refund = await this.applyStripeRefund(refund, stripeRefund);
    const fin = await this.finalize(payment.id, payment.tenantId);
    await this.afterTransition(fin.payment, refund, fin.state, true);
    return this.buildResult(fin.payment, refund, false);
  }

  /** Synchronise l'état local avec Stripe pour un paiement (bouton « actualiser » et webhooks). */
  async syncPayment(args: { tenantId: string; paymentId: string }): Promise<PaymentRecord> {
    const payment = await this.loadPayment(args.tenantId, args.paymentId);
    this.assertAccountConsistent(payment);
    await this.reconcile(payment);
    return this.loadPayment(args.tenantId, args.paymentId);
  }

  /** Point d'entrée webhook : retrouve le paiement par compte connecté + PaymentIntent. */
  async reconcileByPaymentIntent(args: { accountId: string; paymentIntentId: string }): Promise<boolean> {
    const payment = await this.deps.store.getPaymentByIntent(args.accountId, args.paymentIntentId);
    if (!payment) return false;
    await this.reconcile(payment);
    return true;
  }

  /**
   * Lit TOUS les remboursements Stripe du PaymentIntent et aligne la base dessus.
   * L'état Stripe courant fait foi : l'ordre d'arrivée des webhooks n'a donc pas d'importance.
   */
  private async reconcile(payment: PaymentRecord, chargeHint?: StripeChargeDetails): Promise<void> {
    const gateway = this.requireGateway();
    if (!payment.stripePaymentIntentId) return;
    if (payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.LINK_SENT) return;

    const stripeRefunds = await gateway.listRefunds({
      paymentIntentId: payment.stripePaymentIntentId,
      accountId: payment.stripeAccountId,
    });

    const transitions: Array<{ refund: RefundRecord; changed: boolean }> = [];
    for (const sr of stripeRefunds) {
      let local = await this.deps.store.findRefundByStripeId(sr.id);
      if (!local && sr.metadata.refundRecordId) {
        const byMeta = await this.deps.store.findRefundById(sr.metadata.refundRecordId);
        if (byMeta && byMeta.paymentId === payment.id && byMeta.tenantId === payment.tenantId) local = byMeta;
      }
      if (!local) {
        local = await this.deps.store.createExternalRefund({
          tenantId: payment.tenantId,
          paymentId: payment.id,
          leadRequestId: payment.leadRequestId,
          stripeRefundId: sr.id,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          stripeChargeId: sr.chargeId ?? payment.stripeChargeId,
          stripeAccountId: payment.stripeAccountId,
          amount: sr.amount,
          currency: sr.currency,
          status: mapStripeRefundStatus(sr.status),
          failureReason: sr.failureReason,
        });
      }
      const before = local.status;
      const updated = await this.applyStripeRefund(local, sr);
      transitions.push({ refund: updated, changed: before !== updated.status || !local.stripeRefundId });
    }

    const fin = await this.finalize(payment.id, payment.tenantId, chargeHint);
    for (const t of transitions) {
      await this.afterTransition(fin.payment, t.refund, fin.state, false);
    }
  }

  /** Applique un état Stripe sur une ligne locale sans jamais régresser vers un état moins avancé. */
  private async applyStripeRefund(local: RefundRecord, sr: StripeRefundLite): Promise<RefundRecord> {
    const next = mapStripeRefundStatus(sr.status);
    const regress = isTerminal(local.status) && !isTerminal(next);
    return this.deps.store.updateRefund(local.id, {
      stripeRefundId: sr.id,
      stripeChargeId: sr.chargeId ?? local.stripeChargeId,
      status: regress ? local.status : next,
      failureReason: (regress ? local.failureReason : (sr.failureReason ?? null)) ?? null,
      lastSyncedAt: new Date(),
    });
  }

  /** Recalcule l'agrégat paiement/réservation depuis les remboursements confirmés par Stripe. */
  private async finalize(
    paymentId: string,
    tenantId: string,
    chargeHint?: StripeChargeDetails
  ): Promise<{ payment: PaymentRecord; state: PaymentRefundState }> {
    const payment = await this.loadPayment(tenantId, paymentId);
    const refunds = await this.deps.store.listRefunds(paymentId);
    const totals = sumRefunds(refunds);
    const sortedDesc = [...refunds].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = sortedDesc.find((r) => isTerminal(r.status) || r.status === RefundStatus.PENDING);
    const latestTerminalFailure = latest?.status === RefundStatus.FAILED;

    let feeRefunded = payment.applicationFeeRefundedAmount;
    const feeId = chargeHint?.applicationFeeId ?? payment.stripeApplicationFeeId;
    if (feeId && totals.succeeded > 0) {
      try {
        feeRefunded = await this.requireGateway().retrieveApplicationFeeRefunded(feeId);
      } catch {
        // Conserve la dernière valeur connue ; le prochain événement/synchro la corrigera.
      }
    } else if (totals.succeeded === 0) {
      feeRefunded = 0;
    }

    // Attribution de la commission restituée aux remboursements confirmés (information d'historique).
    let remaining = feeRefunded;
    for (const r of [...refunds].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (r.status !== RefundStatus.SUCCEEDED) continue;
      const attributed = Math.min(r.applicationFeeRefundExpected, remaining);
      remaining -= attributed;
      if (attributed !== r.applicationFeeRefunded) {
        await this.deps.store.updateRefund(r.id, { applicationFeeRefunded: attributed });
      }
    }

    const state = derivePaymentRefundState({ paidCents: payment.amount, totals, latestTerminalFailure });
    const status = stateToPaymentStatus(state);
    await this.deps.store.savePaymentAggregate(paymentId, {
      status,
      leadPaymentStatus: stateToLeadPaymentStatus(state),
      refundedAmount: totals.succeeded,
      applicationFeeRefundedAmount: feeRefunded,
      refundedAt: state === "REFUNDED" ? new Date() : null,
      refundsSyncedAt: new Date(),
    });
    return { payment: await this.loadPayment(tenantId, paymentId), state };
  }

  private async afterTransition(
    payment: PaymentRecord,
    refund: RefundRecord,
    state: PaymentRefundState,
    justCreated: boolean
  ): Promise<void> {
    const fresh = (await this.deps.store.findRefundById(refund.id)) ?? refund;
    if (fresh.status === RefundStatus.SUCCEEDED) {
      await this.notify("succeeded", payment, fresh, state);
    } else if (fresh.status === RefundStatus.FAILED) {
      await this.notify("failed", payment, fresh, state);
    } else if (justCreated && (fresh.status === RefundStatus.PENDING || fresh.status === RefundStatus.REQUIRES_ACTION)) {
      await this.notify("initiated", payment, fresh, state);
    }
  }

  private async notify(
    kind: NotificationKind,
    payment: PaymentRecord,
    refund: RefundRecord,
    state: PaymentRefundState
  ): Promise<void> {
    try {
      const claimed = await this.deps.store.claimNotification(refund.id, kind);
      if (!claimed) return;
      await this.deps.notifier.send({
        kind,
        payment,
        refund,
        refundedTotal: payment.refundedAmount,
        fullyRefunded: state === "REFUNDED",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[refund][mail] notification ${kind} ignorée (refund=${refund.id}) : ${msg}`);
    }
  }

  private buildResult(payment: PaymentRecord, refund: RefundRecord, deduplicated: boolean): RequestRefundResult {
    return {
      refund,
      payment,
      deduplicated,
      confirmed: refund.status === RefundStatus.SUCCEEDED,
      paymentState: paymentStatusToState(payment.status),
    };
  }
}

export function stateToPaymentStatus(state: PaymentRefundState): PaymentStatus {
  switch (state) {
    case "REFUND_PENDING":
      return PaymentStatus.REFUND_PENDING;
    case "PARTIALLY_REFUNDED":
      return PaymentStatus.PARTIALLY_REFUNDED;
    case "REFUNDED":
      return PaymentStatus.REFUNDED;
    case "REFUND_FAILED":
      return PaymentStatus.REFUND_FAILED;
    default:
      return PaymentStatus.PAID;
  }
}

export function stateToLeadPaymentStatus(state: PaymentRefundState): LeadPaymentStatus {
  switch (state) {
    case "REFUND_PENDING":
      return LeadPaymentStatus.REFUND_PENDING;
    case "PARTIALLY_REFUNDED":
      return LeadPaymentStatus.PARTIALLY_REFUNDED;
    case "REFUNDED":
      return LeadPaymentStatus.REFUNDED;
    case "REFUND_FAILED":
      return LeadPaymentStatus.REFUND_FAILED;
    default:
      return LeadPaymentStatus.PAID;
  }
}

function paymentStatusToState(status: PaymentStatus): PaymentRefundState {
  switch (status) {
    case PaymentStatus.REFUND_PENDING:
      return "REFUND_PENDING";
    case PaymentStatus.PARTIALLY_REFUNDED:
      return "PARTIALLY_REFUNDED";
    case PaymentStatus.REFUNDED:
      return "REFUNDED";
    case PaymentStatus.REFUND_FAILED:
      return "REFUND_FAILED";
    default:
      return "PAID";
  }
}
