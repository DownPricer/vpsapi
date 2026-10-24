import { LeadPaymentStatus, PaymentStatus, RefundInitiator, RefundStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { refundableCents, sumRefunds } from "../../services/stripe/refundMath";
import { RefundService } from "../../services/stripe/refund.service";
import type {
  NotificationKind,
  PaymentAggregatePatch,
  PaymentRecord,
  RefundNotifier,
  RefundNotifyContext,
  RefundRecord,
  RefundStore,
  RefundStripeGateway,
  ReserveInput,
  ReserveResult,
  StripeChargeDetails,
  StripeRefundLite,
} from "../../services/stripe/refund.types";

/** Store en mémoire : mêmes règles que PrismaRefundStore (réservation atomique, dédup par clientRequestId). */
export class MemoryRefundStore implements RefundStore {
  payments = new Map<string, PaymentRecord>();
  leadPaymentStatus = new Map<string, LeadPaymentStatus>();
  refunds = new Map<string, RefundRecord>();
  refundedAt = new Map<string, Date | null>();

  addPayment(p: PaymentRecord): void {
    this.payments.set(p.id, p);
    this.leadPaymentStatus.set(p.leadRequestId, LeadPaymentStatus.PAID);
  }

  async getPayment(tenantId: string, paymentId: string): Promise<PaymentRecord | null> {
    const p = this.payments.get(paymentId);
    return p && p.tenantId === tenantId ? { ...p } : null;
  }

  async getPaymentByIntent(accountId: string, paymentIntentId: string): Promise<PaymentRecord | null> {
    for (const p of this.payments.values()) {
      if (p.stripePaymentIntentId === paymentIntentId && p.stripeAccountId === accountId) return { ...p };
    }
    return null;
  }

  async setPaymentCharge(paymentId: string, c: { chargeId: string; applicationFeeId: string | null }): Promise<void> {
    const p = this.payments.get(paymentId)!;
    p.stripeChargeId = c.chargeId;
    p.stripeApplicationFeeId = c.applicationFeeId;
  }

  async reserveRefund(input: ReserveInput): Promise<ReserveResult> {
    // Aucune attente (await) entre la lecture et l'écriture : l'opération est atomique, comme sous FOR UPDATE.
    const existing = [...this.refunds.values()].find(
      (r) => r.paymentId === input.paymentId && r.clientRequestId === input.clientRequestId
    );
    if (existing) return { kind: "existing", refund: { ...existing } };
    const payment = this.payments.get(input.paymentId);
    const list = [...this.refunds.values()].filter((r) => r.paymentId === input.paymentId);
    const totals = sumRefunds(list);
    const refundable = payment ? refundableCents(payment.amount, totals) : 0;
    const okStatus =
      payment &&
      ([
        PaymentStatus.PAID,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUND_FAILED,
        PaymentStatus.REFUND_PENDING,
      ] as PaymentStatus[]).includes(payment.status);
    if (!payment || !okStatus) return { kind: "rejected", code: "PAYMENT_NOT_REFUNDABLE", refundable };
    if (totals.inFlight > 0) return { kind: "rejected", code: "REFUND_IN_PROGRESS", refundable };
    if (input.amount < 1 || input.amount > refundable) {
      return { kind: "rejected", code: "AMOUNT_EXCEEDS_REFUNDABLE", refundable };
    }
    const now = new Date();
    const created: RefundRecord = {
      id: `rf_${randomUUID()}`,
      tenantId: input.tenantId,
      paymentId: input.paymentId,
      leadRequestId: payment.leadRequestId,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
      stripeRefundId: null,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeChargeId: input.stripeChargeId,
      stripeAccountId: input.stripeAccountId,
      amount: input.amount,
      currency: payment.currency,
      status: RefundStatus.PENDING,
      reason: input.reason,
      reasonNote: input.reasonNote,
      failureReason: null,
      initiatedBy: input.initiatedBy,
      initiatedByUserId: input.initiatedByUserId,
      applicationFeeRefundExpected: input.expectedFee(totals),
      applicationFeeRefunded: 0,
      notifiedInitiatedAt: null,
      notifiedSucceededAt: null,
      notifiedFailedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.refunds.set(created.id, created);
    return { kind: "created", refund: { ...created } };
  }

  async findRefundByStripeId(id: string): Promise<RefundRecord | null> {
    const r = [...this.refunds.values()].find((x) => x.stripeRefundId === id);
    return r ? { ...r } : null;
  }

  async findRefundById(id: string): Promise<RefundRecord | null> {
    const r = this.refunds.get(id);
    return r ? { ...r } : null;
  }

  async createExternalRefund(i: Parameters<RefundStore["createExternalRefund"]>[0]): Promise<RefundRecord> {
    const now = new Date();
    const r: RefundRecord = {
      id: `rf_${randomUUID()}`,
      tenantId: i.tenantId,
      paymentId: i.paymentId,
      leadRequestId: i.leadRequestId,
      clientRequestId: `ext_${i.stripeRefundId}`,
      idempotencyKey: `ext_${i.stripeRefundId}`,
      stripeRefundId: i.stripeRefundId,
      stripePaymentIntentId: i.stripePaymentIntentId,
      stripeChargeId: i.stripeChargeId,
      stripeAccountId: i.stripeAccountId,
      amount: i.amount,
      currency: i.currency,
      status: i.status,
      reason: "stripe_dashboard",
      reasonNote: null,
      failureReason: i.failureReason,
      initiatedBy: RefundInitiator.STRIPE_DASHBOARD,
      initiatedByUserId: null,
      applicationFeeRefundExpected: 0,
      applicationFeeRefunded: 0,
      notifiedInitiatedAt: null,
      notifiedSucceededAt: null,
      notifiedFailedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.refunds.set(r.id, r);
    return { ...r };
  }

  async updateRefund(id: string, patch: Parameters<RefundStore["updateRefund"]>[1]): Promise<RefundRecord> {
    const r = this.refunds.get(id)!;
    Object.assign(r, patch, { updatedAt: new Date() });
    return { ...r };
  }

  async listRefunds(paymentId: string): Promise<RefundRecord[]> {
    return [...this.refunds.values()]
      .filter((r) => r.paymentId === paymentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async savePaymentAggregate(paymentId: string, patch: PaymentAggregatePatch): Promise<void> {
    const p = this.payments.get(paymentId)!;
    p.status = patch.status;
    p.refundedAmount = patch.refundedAmount;
    p.applicationFeeRefundedAmount = patch.applicationFeeRefundedAmount;
    this.refundedAt.set(paymentId, patch.refundedAt);
    this.leadPaymentStatus.set(p.leadRequestId, patch.leadPaymentStatus);
  }

  async claimNotification(refundId: string, kind: NotificationKind): Promise<boolean> {
    const r = this.refunds.get(refundId)!;
    const field = kind === "initiated" ? "notifiedInitiatedAt" : kind === "succeeded" ? "notifiedSucceededAt" : "notifiedFailedAt";
    if (r[field]) return false;
    r[field] = new Date();
    return true;
  }
}

type FakeCharge = {
  chargeId: string;
  amount: number;
  amountRefunded: number;
  feeAmount: number;
  feeId: string;
  feeRefunded: number;
  accountId: string;
  direct: boolean;
};

export class StripeNetworkError extends Error {
  type = "StripeConnectionError";
}
export class StripeRejectError extends Error {
  type = "StripeInvalidRequestError";
  constructor(public code: string) {
    super(code);
  }
}

export class FakeGateway implements RefundStripeGateway {
  charges = new Map<string, FakeCharge>();
  refunds: StripeRefundLite[] = [];
  byIdempotencyKey = new Map<string, StripeRefundLite>();
  createCalls = 0;
  /** Prochain createRefund : 'network' (rien créé), 'lost' (créé puis réponse perdue), 'reject' (refus définitif). */
  nextCreateFailure: "network" | "lost" | "reject" | null = null;
  /** Statut Stripe des nouveaux remboursements. */
  newRefundStatus: "succeeded" | "pending" = "succeeded";
  /** Accrochage de test exécuté juste après l'appel Stripe (simule un webhook concurrent). */
  afterCreate: ((r: StripeRefundLite) => Promise<void>) | null = null;
  private seq = 0;
  /** Identifiants Stripe uniques entre instances (comme les vrais re_…), nécessaire pour les tests sur base réelle. */
  private readonly prefix = `re_${randomUUID().slice(0, 8)}`;

  addCharge(pi: string, accountId: string, amount: number, fee: number, direct = true): void {
    this.charges.set(pi, {
      chargeId: `ch_${pi}`,
      amount,
      amountRefunded: 0,
      feeAmount: fee,
      feeId: `fee_${pi}`,
      feeRefunded: 0,
      accountId,
      direct,
    });
  }

  async retrieveChargeDetails(a: { paymentIntentId: string; accountId: string }): Promise<StripeChargeDetails> {
    const c = this.charges.get(a.paymentIntentId);
    if (!c || c.accountId !== a.accountId || !c.direct) throw new StripeRejectError("resource_missing");
    return {
      chargeId: c.chargeId,
      paymentIntentId: a.paymentIntentId,
      amount: c.amount,
      amountRefunded: c.amountRefunded,
      currency: "eur",
      applicationFeeId: c.feeId,
      applicationFeeAmount: c.feeAmount,
      paid: true,
      directCharge: true,
    };
  }

  async createRefund(a: Parameters<RefundStripeGateway["createRefund"]>[0]): Promise<StripeRefundLite> {
    this.createCalls += 1;
    const replay = this.byIdempotencyKey.get(a.idempotencyKey);
    if (replay) return replay; // Stripe renvoie la réponse initiale pour une clé déjà utilisée
    if (this.nextCreateFailure === "network") {
      this.nextCreateFailure = null;
      throw new StripeNetworkError("connection error");
    }
    if (this.nextCreateFailure === "reject") {
      this.nextCreateFailure = null;
      throw new StripeRejectError("balance_insufficient");
    }
    const c = this.charges.get(a.paymentIntentId);
    if (!c || c.accountId !== a.accountId) throw new StripeRejectError("resource_missing");
    if (a.amount > c.amount - c.amountRefunded) throw new StripeRejectError("charge_already_refunded");

    c.amountRefunded += a.amount;
    if (a.refundApplicationFee) {
      const feeLeft = c.feeAmount - c.feeRefunded;
      c.feeRefunded += c.amountRefunded >= c.amount ? feeLeft : Math.min(feeLeft, Math.round((c.feeAmount * a.amount) / c.amount));
    }
    this.seq += 1;
    const r: StripeRefundLite = {
      id: `${this.prefix}_${this.seq}`,
      status: this.newRefundStatus,
      amount: a.amount,
      currency: "eur",
      paymentIntentId: a.paymentIntentId,
      chargeId: c.chargeId,
      failureReason: null,
      metadata: a.metadata,
      created: this.seq,
    };
    this.refunds.push(r);
    this.byIdempotencyKey.set(a.idempotencyKey, r);
    if (this.afterCreate) await this.afterCreate(r);
    if (this.nextCreateFailure === "lost") {
      this.nextCreateFailure = null;
      throw new StripeNetworkError("response lost");
    }
    return { ...r };
  }

  async listRefunds(a: { paymentIntentId: string; accountId: string }): Promise<StripeRefundLite[]> {
    return this.refunds.filter((r) => r.paymentIntentId === a.paymentIntentId).map((r) => ({ ...r }));
  }

  async retrieveApplicationFeeRefunded(feeId: string): Promise<number> {
    for (const c of this.charges.values()) if (c.feeId === feeId) return c.feeRefunded;
    return 0;
  }

  /** Simule la mise à jour d'un remboursement par Stripe (ex. pending → succeeded). */
  setRefundStatus(stripeRefundId: string, status: string, failureReason: string | null = null): void {
    const r = this.refunds.find((x) => x.id === stripeRefundId)!;
    r.status = status;
    r.failureReason = failureReason;
    if (status === "failed") {
      const c = this.charges.get(r.paymentIntentId as string)!;
      c.amountRefunded -= r.amount;
    }
  }

  /** Remboursement créé depuis le dashboard Stripe du chauffeur (hors plateforme). */
  addDashboardRefund(pi: string, amount: number): StripeRefundLite {
    const c = this.charges.get(pi)!;
    c.amountRefunded += amount;
    this.seq += 1;
    const r: StripeRefundLite = {
      id: `${this.prefix}_${this.seq}`,
      status: "succeeded",
      amount,
      currency: "eur",
      paymentIntentId: pi,
      chargeId: c.chargeId,
      failureReason: null,
      metadata: {},
      created: this.seq,
    };
    this.refunds.push(r);
    return r;
  }
}

export class FakeNotifier implements RefundNotifier {
  sent: RefundNotifyContext[] = [];
  async send(ctx: RefundNotifyContext): Promise<void> {
    this.sent.push(ctx);
  }
  kinds(): string[] {
    return this.sent.map((s) => s.kind);
  }
}

export const TENANT = "tenant_a";
export const OTHER_TENANT = "tenant_b";
export const ACCOUNT = "acct_A";
export const PI = "pi_123";

export function makeEnv(opts: { amount?: number; fee?: number } = {}) {
  const amount = opts.amount ?? 10_000;
  const fee = opts.fee ?? 500;
  const store = new MemoryRefundStore();
  const gateway = new FakeGateway();
  const notifier = new FakeNotifier();
  store.addPayment({
    id: "pay_1",
    tenantId: TENANT,
    leadRequestId: "lead_1",
    status: PaymentStatus.PAID,
    amount,
    currency: "eur",
    applicationFeeAmount: fee,
    stripeAccountId: ACCOUNT,
    stripePaymentIntentId: PI,
    stripeChargeId: null,
    stripeApplicationFeeId: null,
    refundedAmount: 0,
    applicationFeeRefundedAmount: 0,
    tenantStripeAccountId: ACCOUNT,
  });
  gateway.addCharge(PI, ACCOUNT, amount, fee);
  const service = new RefundService({ store, gateway: () => gateway, notifier });
  return { store, gateway, notifier, service };
}
