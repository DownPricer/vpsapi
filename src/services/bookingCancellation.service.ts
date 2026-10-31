import { syncLeadOccupation } from "./vehicleAvailability.service";
import type { LeadRequest } from "@prisma/client";
import { CancellationRequestStatus, LeadPaymentStatus, LeadStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { sendCancellationOutcomeMail, sendCancellationRequestMails, type MailOutcome } from "../modules/email/cancellationMail";
import type { TenantConfig } from "../types/tenant";
import { resolveBookingAccess } from "./bookingAccess.service";
import { parseStoredSnapshot, policyLines } from "./cancellationPolicy";
import { getRefundService } from "./refundContainer";
import { getStripeClient } from "./stripe/stripeClient";
import { formatEurCents } from "./stripe/refundMath";
import { RefundServiceError, type RequestRefundResult } from "./stripe/refund.service";
import type { RefundPreview } from "./stripe/refund.types";
import { notifyTenantPush } from "./push";

export class BookingCancellationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "BookingCancellationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Convertit une erreur de remboursement en erreur d'annulation.
 * STRIPE_UNCERTAIN → REFUND_UNCERTAIN (502) : ne jamais annuler la réservation ;
 * le client doit réessayer avec le même clientRequestId.
 */
export function mapRefundFailureToCancellationError(e: unknown): never {
  if (e instanceof RefundServiceError && e.code === "STRIPE_UNCERTAIN") {
    throw new BookingCancellationError(
      "REFUND_UNCERTAIN",
      "Le remboursement Stripe n'a pas pu être confirmé. Ne réessayez pas avec un nouvel identifiant : renvoyez la même demande avec le même clientRequestId.",
      502
    );
  }
  throw e;
}

export type RefundPlan = { mode: "none" } | { mode: "full" } | { mode: "partial"; amountCents: number };

const PAID_FAMILY: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUND_FAILED,
];
const UNPAID_OPEN: PaymentStatus[] = [PaymentStatus.LINK_SENT, PaymentStatus.PENDING];

const CANCELLABLE_BY_OPERATOR: LeadStatus[] = [
  LeadStatus.new,
  LeadStatus.pending,
  LeadStatus.accepted,
  LeadStatus.scheduled,
  LeadStatus.processed,
  LeadStatus.cancellation_requested,
];
const CANCELLABLE_BY_CUSTOMER: LeadStatus[] = [
  LeadStatus.new,
  LeadStatus.pending,
  LeadStatus.accepted,
  LeadStatus.scheduled,
  LeadStatus.processed,
];

export type CancelPreview = {
  leadId: string;
  leadStatus: LeadStatus;
  paymentStatus: LeadPaymentStatus;
  hasOpenPaymentLink: boolean;
  payment: null | {
    id: string;
    status: PaymentStatus;
    refund: RefundPreview;
  };
  pendingRequest: null | { id: string; reason: string; requestedAt: Date };
  cancellable: boolean;
};

export async function previewCancellation(tenantId: string, leadId: string): Promise<CancelPreview> {
  const lead = await prisma.leadRequest.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw new BookingCancellationError("NOT_FOUND", "Demande introuvable.", 404);

  const [paid, openLinks, pending] = await Promise.all([
    prisma.payment.findFirst({
      where: { tenantId, leadRequestId: leadId, status: { in: [...PAID_FAMILY, PaymentStatus.REFUNDED] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
    prisma.payment.count({ where: { tenantId, leadRequestId: leadId, status: { in: UNPAID_OPEN } } }),
    prisma.cancellationRequest.findFirst({
      where: { tenantId, leadRequestId: leadId, status: CancellationRequestStatus.PENDING },
      orderBy: { requestedAt: "desc" },
    }),
  ]);

  let payment: CancelPreview["payment"] = null;
  if (paid) {
    const refund = await getRefundService().preview({ tenantId, paymentId: paid.id });
    payment = { id: paid.id, status: paid.status, refund };
  }
  return {
    leadId,
    leadStatus: lead.status,
    paymentStatus: lead.paymentStatus,
    hasOpenPaymentLink: openLinks > 0,
    payment,
    pendingRequest: pending ? { id: pending.id, reason: pending.reason, requestedAt: pending.requestedAt } : null,
    cancellable: CANCELLABLE_BY_OPERATOR.includes(lead.status),
  };
}

/** Expire les sessions Checkout ouvertes (meilleur effort) et annule les paiements non payés. */
async function cancelUnpaidPayments(tenantId: string, leadId: string): Promise<number> {
  const open = await prisma.payment.findMany({
    where: { tenantId, leadRequestId: leadId, status: { in: UNPAID_OPEN } },
  });
  const stripe = getStripeClient();
  let cancelled = 0;
  for (const p of open) {
    if (stripe && p.stripeCheckoutSessionId) {
      try {
        await stripe.checkout.sessions.expire(p.stripeCheckoutSessionId, {}, { stripeAccount: p.stripeAccountId });
      } catch {
        // Session déjà expirée / complétée : on vérifie qu'elle n'a pas été payée entre-temps.
        try {
          const s = await stripe.checkout.sessions.retrieve(p.stripeCheckoutSessionId, {}, { stripeAccount: p.stripeAccountId });
          if (s.payment_status === "paid") {
            throw new BookingCancellationError(
              "PAYMENT_COMPLETED_DURING_CANCEL",
              "Le client vient de payer : rechargez la page puis relancez l'annulation (avec remboursement si nécessaire).",
              409
            );
          }
        } catch (inner) {
          if (inner instanceof BookingCancellationError) throw inner;
        }
      }
    }
    const res = await prisma.payment.updateMany({
      where: { id: p.id, status: { in: UNPAID_OPEN } },
      data: { status: PaymentStatus.CANCELLED },
    });
    cancelled += res.count;
  }
  return cancelled;
}

function refundNoteFor(result: RequestRefundResult | null, uncertain: boolean): string | null {
  if (uncertain) return "Un remboursement a été demandé ; sa confirmation est en cours de vérification.";
  if (!result) return null;
  const amount = formatEurCents(result.refund.amount);
  return result.confirmed
    ? `Un remboursement de ${amount} a été effectué et sera visible sous quelques jours ouvrés.`
    : `Un remboursement de ${amount} est en cours de traitement.`;
}

export type CancelBookingInput = {
  tenant: TenantConfig;
  tenantId: string;
  leadId: string;
  actorUserId: string | null;
  reason: string;
  refund: RefundPlan;
  refundConfirmed: boolean;
  clientRequestId: string;
  notifyCustomer: boolean;
  operatorNote?: string | null;
  /** Annulation issue d'une demande client acceptée. */
  acceptRequest?: boolean;
};

export type CancelBookingResult = {
  lead: LeadRequest;
  refund: RequestRefundResult | null;
  refundUncertain: boolean;
  unpaidPaymentsCancelled: number;
  mail: MailOutcome | null;
};

export async function cancelBooking(input: CancelBookingInput): Promise<CancelBookingResult> {
  const lead = await prisma.leadRequest.findFirst({ where: { id: input.leadId, tenantId: input.tenantId } });
  if (!lead) throw new BookingCancellationError("NOT_FOUND", "Demande introuvable.", 404);
  if (lead.status === LeadStatus.cancelled) {
    throw new BookingCancellationError("ALREADY_CANCELLED", "Cette réservation est déjà annulée.", 409);
  }
  if (!CANCELLABLE_BY_OPERATOR.includes(lead.status)) {
    throw new BookingCancellationError("NOT_CANCELLABLE", "Cette demande ne peut plus être annulée dans son état actuel.", 409);
  }

  const paid = await prisma.payment.findFirst({
    where: { tenantId: input.tenantId, leadRequestId: input.leadId, status: { in: [...PAID_FAMILY, PaymentStatus.REFUNDED] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // 1) Remboursement (jamais implicite : confirmation explicite exigée).
  let refundResult: RequestRefundResult | null = null;
  if (input.refund.mode !== "none") {
    if (!paid) {
      throw new BookingCancellationError("NO_PAID_PAYMENT", "Aucun paiement encaissé à rembourser pour cette réservation.", 409);
    }
    if (!input.refundConfirmed) {
      throw new BookingCancellationError("REFUND_CONFIRMATION_REQUIRED", "Confirmez explicitement le remboursement pour continuer.", 400);
    }
    try {
      refundResult = await getRefundService().requestRefund({
        tenantId: input.tenantId,
        paymentId: paid.id,
        full: input.refund.mode === "full",
        amountCents: input.refund.mode === "partial" ? input.refund.amountCents : undefined,
        reason: input.acceptRequest ? "customer_request" : "driver_cancelled",
        note: input.reason,
        clientRequestId: input.clientRequestId,
        initiatedByUserId: input.actorUserId,
      });
    } catch (e) {
      // Rien n'est annulé tant que le remboursement n'est pas confirmé (refus ou état Stripe inconnu).
      throw mapRefundFailureToCancellationError(e);
    }
  }

  // 2) Liens de paiement ouverts.
  const unpaidPaymentsCancelled = await cancelUnpaidPayments(input.tenantId, input.leadId);

  // 3) Réservation + historique + demande client éventuelle.
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.leadRequest.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.cancelled,
        cancelledAt: now,
        cancellationReason: input.reason.slice(0, 500),
        ...(!paid && unpaidPaymentsCancelled > 0 ? { paymentStatus: LeadPaymentStatus.CANCELLED } : {}),
      },
    });
    // Annulation CONFIRMÉE : le véhicule est libéré (la réservation et son historique restent en base).
    await syncLeadOccupation(tx, lead.id);
    await tx.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId: lead.tenantId,
        previousStatus: lead.status,
        newStatus: LeadStatus.cancelled,
        changedByUserId: input.actorUserId,
        note: `Annulée${input.acceptRequest ? " (demande du client acceptée)" : " par le chauffeur"} — ${input.reason.slice(0, 300)}`,
      },
    });
    await tx.cancellationRequest.updateMany({
      where: { tenantId: lead.tenantId, leadRequestId: lead.id, status: CancellationRequestStatus.PENDING },
      data: {
        status: CancellationRequestStatus.ACCEPTED,
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: input.operatorNote?.slice(0, 500) ?? null,
      },
    });
    return fresh;
  });

  // 4) E-mail client (le détail du remboursement part du service de remboursement).
  let mail: MailOutcome | null = null;
  if (input.notifyCustomer) {
    mail = await sendCancellationOutcomeMail({
      tenant: input.tenant,
      lead: updated,
      outcome: input.acceptRequest ? "accepted" : "cancelled_by_driver",
      reason: input.reason,
      operatorNote: input.operatorNote,
      refundNote: refundNoteFor(refundResult, false),
    });
  }

  return { lead: updated, refund: refundResult, refundUncertain: false, unpaidPaymentsCancelled, mail };
}

/* -------------------------------------------------------------------------- */
/*  Côté client (jeton)                                                       */
/* -------------------------------------------------------------------------- */

export type CustomerBookingView = {
  companyName: string;
  reference: string;
  kind: string;
  status: LeadStatus;
  rideDate: string | null;
  tripSummary: string | null;
  payment: null | { paidCents: number; refundedCents: number; currency: string; state: PaymentStatus };
  policy: null | {
    version: number;
    capturedAt: string;
    lines: Array<{ label: string; text: string }>;
  };
  cancellationRequest: null | { status: CancellationRequestStatus; requestedAt: string };
  canRequestCancellation: boolean;
};

function accessError(reason: "invalid" | "expired"): BookingCancellationError {
  return reason === "expired"
    ? new BookingCancellationError("LINK_EXPIRED", "Ce lien a expiré. Contactez votre chauffeur.", 410)
    : new BookingCancellationError("LINK_INVALID", "Lien invalide.", 404);
}

export async function getCustomerBookingView(tenant: TenantConfig, tenantId: string, token: unknown): Promise<CustomerBookingView> {
  const access = await resolveBookingAccess(tenantId, token);
  if (!access.ok) throw accessError(access.reason);
  const lead = access.lead;

  const [payment, request] = await Promise.all([
    prisma.payment.findFirst({
      where: { tenantId, leadRequestId: lead.id, status: { in: [...PAID_FAMILY, PaymentStatus.REFUNDED] } },
      orderBy: { createdAt: "desc" },
      select: { amount: true, refundedAmount: true, currency: true, status: true },
    }),
    prisma.cancellationRequest.findFirst({ where: { tenantId, leadRequestId: lead.id }, orderBy: { requestedAt: "desc" } }),
  ]);

  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  const summary = ["RésuméTrajet", "ResumeTrajet"].map((k) => flat[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const snapshot = parseStoredSnapshot(lead.cancellationPolicySnapshot);
  const rideInFuture = !lead.scheduledStart || lead.scheduledStart.getTime() > Date.now();

  return {
    companyName: tenant.company.name,
    reference: lead.id,
    kind: lead.kind,
    status: lead.status,
    rideDate: lead.scheduledStart ? lead.scheduledStart.toISOString() : null,
    tripSummary: summary?.trim() ?? null,
    payment: payment
      ? { paidCents: payment.amount, refundedCents: payment.refundedAmount, currency: payment.currency, state: payment.status }
      : null,
    policy: snapshot
      ? { version: snapshot.policy.version, capturedAt: snapshot.capturedAt, lines: policyLines(snapshot.policy) }
      : null,
    cancellationRequest: request ? { status: request.status, requestedAt: request.requestedAt.toISOString() } : null,
    canRequestCancellation:
      CANCELLABLE_BY_CUSTOMER.includes(lead.status) && rideInFuture && request?.status !== CancellationRequestStatus.PENDING,
  };
}

export async function createCustomerCancellationRequest(
  tenant: TenantConfig,
  tenantId: string,
  token: unknown,
  reason: string
): Promise<{ requestId: string; status: CancellationRequestStatus }> {
  const access = await resolveBookingAccess(tenantId, token);
  if (!access.ok) throw accessError(access.reason);
  const lead = access.lead;

  if (!CANCELLABLE_BY_CUSTOMER.includes(lead.status)) {
    throw new BookingCancellationError(
      lead.status === LeadStatus.cancellation_requested ? "ALREADY_REQUESTED" : "NOT_CANCELLABLE",
      lead.status === LeadStatus.cancellation_requested
        ? "Une demande d'annulation est déjà en cours de traitement."
        : "Cette réservation ne peut plus faire l'objet d'une demande d'annulation.",
      409
    );
  }
  if (lead.scheduledStart && lead.scheduledStart.getTime() <= Date.now()) {
    throw new BookingCancellationError("RIDE_ALREADY_STARTED", "La course est déjà passée ou en cours : contactez directement votre chauffeur.", 409);
  }

  const request = await prisma.$transaction(async (tx) => {
    // Re-lecture sous transaction : deux clics simultanés ne créent qu'une seule demande.
    const claimed = await tx.leadRequest.updateMany({
      where: { id: lead.id, tenantId, status: { in: CANCELLABLE_BY_CUSTOMER } },
      data: { status: LeadStatus.cancellation_requested },
    });
    if (claimed.count === 0) {
      throw new BookingCancellationError("ALREADY_REQUESTED", "Une demande d'annulation est déjà en cours de traitement.", 409);
    }
    const created = await tx.cancellationRequest.create({
      data: {
        tenantId,
        leadRequestId: lead.id,
        reason: reason.slice(0, 1000),
        previousLeadStatus: lead.status,
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId,
        previousStatus: lead.status,
        newStatus: LeadStatus.cancellation_requested,
        changedByUserId: null,
        note: `Demande d'annulation du client — ${reason.slice(0, 300)}`,
      },
    });
    return created;
  });

  const fresh = (await prisma.leadRequest.findUnique({ where: { id: lead.id } })) ?? lead;
  void sendCancellationRequestMails({ tenant, lead: fresh, reason }).catch(() => undefined);
  notifyTenantPush(tenantId, "cancellation_request", lead.id);
  return { requestId: request.id, status: request.status };
}

/* -------------------------------------------------------------------------- */
/*  Traitement par le chauffeur                                               */
/* -------------------------------------------------------------------------- */

export type ResolveDecision = "accept" | "refuse" | "manual";

export async function resolveCancellationRequest(input: {
  tenant: TenantConfig;
  tenantId: string;
  leadId: string;
  actorUserId: string | null;
  decision: ResolveDecision;
  refund: RefundPlan;
  refundConfirmed: boolean;
  clientRequestId: string;
  note?: string | null;
  notifyCustomer: boolean;
}): Promise<{ result: CancelBookingResult | null; lead: LeadRequest }> {
  const request = await prisma.cancellationRequest.findFirst({
    where: { tenantId: input.tenantId, leadRequestId: input.leadId, status: CancellationRequestStatus.PENDING },
    orderBy: { requestedAt: "desc" },
  });
  if (!request) throw new BookingCancellationError("NO_PENDING_REQUEST", "Aucune demande d'annulation en attente.", 404);

  if (input.decision === "accept") {
    const result = await cancelBooking({
      tenant: input.tenant,
      tenantId: input.tenantId,
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      reason: request.reason,
      refund: input.refund,
      refundConfirmed: input.refundConfirmed,
      clientRequestId: input.clientRequestId,
      notifyCustomer: input.notifyCustomer,
      operatorNote: input.note,
      acceptRequest: true,
    });
    return { result, lead: result.lead };
  }

  if (input.refund.mode !== "none") {
    throw new BookingCancellationError("REFUND_NOT_ALLOWED", "Aucun remboursement n'est possible sans annulation.", 400);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.cancellationRequest.updateMany({
      where: { id: request.id, status: CancellationRequestStatus.PENDING },
      data: {
        status: input.decision === "refuse" ? CancellationRequestStatus.REFUSED : CancellationRequestStatus.MANUAL,
        resolvedAt: now,
        resolvedByUserId: input.actorUserId,
        resolutionNote: input.note?.slice(0, 500) ?? null,
      },
    });
    if (claimed.count === 0) {
      throw new BookingCancellationError("NO_PENDING_REQUEST", "Cette demande a déjà été traitée.", 409);
    }
    const lead = await tx.leadRequest.update({ where: { id: input.leadId }, data: { status: request.previousLeadStatus } });
    await syncLeadOccupation(tx, input.leadId);
    await tx.leadStatusHistory.create({
      data: {
        leadId: input.leadId,
        tenantId: input.tenantId,
        previousStatus: LeadStatus.cancellation_requested,
        newStatus: request.previousLeadStatus,
        changedByUserId: input.actorUserId,
        note: input.decision === "refuse" ? "Demande d'annulation refusée" : "Demande d'annulation traitée manuellement",
      },
    });
    return lead;
  });

  if (input.notifyCustomer) {
    await sendCancellationOutcomeMail({
      tenant: input.tenant,
      lead: updated,
      outcome: input.decision === "refuse" ? "refused" : "manual",
      operatorNote: input.note,
    });
  }
  return { result: null, lead: updated };
}
