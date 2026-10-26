import { vehicleLabelFromFlat } from "../leads/vehicleLead";
import type { LeadRequest } from "@prisma/client";
import { PaymentStatus } from "@prisma/client";
import { resolveTenantConfig } from "../../tenancy/tenantRuntimeConfig";
import { prisma } from "../../db/prisma";
import { parseStoredSnapshot, policyLines } from "../../services/cancellationPolicy";
import { tryBuildManageUrl } from "../../services/bookingAccess.service";
import { formatEurCents } from "../../services/stripe/refundMath";
import type { RefundNotifier, RefundNotifyContext } from "../../services/stripe/refund.types";
import type { TenantConfig } from "../../types/tenant";
import {
  buildCancellationAcceptedCustomer,
  buildCancellationRefusedCustomer,
  buildCancellationRequestReceivedCustomer,
  buildCancellationRequestReceivedOperator,
  buildCancelledByDriverCustomer,
  buildRefundConfirmedCustomer,
  buildRefundFailedEmail,
  buildRefundInitiatedCustomer,
  type MailCommon,
} from "./formatCancellationEmails";
import { paymentLinkClientGreetingName, pickVtcPhoneFromTenantSettings, resolveClientEmailForPaymentMail } from "./paymentLinkMail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

export type MailOutcome = { attempted: boolean; sent: boolean; error?: string };

function rideDateLabel(lead: LeadRequest): string | null {
  if (!lead.scheduledStart) return null;
  return lead.scheduledStart.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tripSummaryOf(lead: LeadRequest): string | null {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  for (const key of ["RésuméTrajet", "ResumeTrajet"]) {
    const v = flat[key];
    if (typeof v === "string" && v.trim()) {
      const veh = vehicleLabelFromFlat(flat);
      return veh ? `${v.trim()} — Véhicule : ${veh}` : v.trim();
    }
  }
  return null;
}

async function commonFor(tenant: TenantConfig, lead: LeadRequest): Promise<MailCommon> {
  const row = await prisma.tenant.findUnique({ where: { id: lead.tenantId }, select: { settings: true } });
  return {
    tenant,
    clientName: paymentLinkClientGreetingName(lead) || lead.clientName?.trim() || undefined,
    reference: lead.id,
    tripSummary: tripSummaryOf(lead),
    rideDateLabel: rideDateLabel(lead),
    vtcPhone: pickVtcPhoneFromTenantSettings(row?.settings ?? null) ?? null,
    vtcEmail: tenant.smtp?.toEmail?.trim() || null,
  };
}

function proUrlFor(tenant: TenantConfig, leadId: string): string | null {
  const base = tenant.branding?.siteUrl?.trim().replace(/\/$/, "");
  return base ? `${base}/pro/demandes/${leadId}` : null;
}

async function deliver(
  tenant: TenantConfig,
  to: string | null,
  pkg: { subject: string; html: string; text: string }
): Promise<MailOutcome> {
  if (!to?.includes("@")) return { attempted: false, sent: false, error: "no_recipient" };
  try {
    const connection = assertSmtpConnection();
    await sendSmtpMessage({
      connection,
      from: resolveMailFrom(tenant),
      to,
      subject: pkg.subject,
      html: pkg.html,
      text: pkg.text,
      omitAutoBcc: true,
    });
    return { attempted: true, sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[cancellation][mail] envoi échoué : ${msg}`);
    return { attempted: true, sent: false, error: "smtp_failed" };
  }
}

async function paidAmountOf(lead: LeadRequest): Promise<number | null> {
  const p = await prisma.payment.findFirst({
    where: {
      tenantId: lead.tenantId,
      leadRequestId: lead.id,
      status: {
        in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUND_PENDING, PaymentStatus.REFUND_FAILED, PaymentStatus.REFUNDED],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { amount: true },
  });
  return p?.amount ?? null;
}

export async function sendCancellationRequestMails(args: {
  tenant: TenantConfig;
  lead: LeadRequest;
  reason: string;
}): Promise<{ customer: MailOutcome; operator: MailOutcome }> {
  const common = await commonFor(args.tenant, args.lead);
  const paid = await paidAmountOf(args.lead);
  const amountPaidFormatted = paid ? formatEurCents(paid) : null;
  const snapshot = parseStoredSnapshot(args.lead.cancellationPolicySnapshot);
  const policy = snapshot ? policyLines(snapshot.policy).map((l) => ({ title: l.label, text: l.text })) : [];
  const manageUrl = await tryBuildManageUrl(args.tenant, args.lead);

  const customerPkg = buildCancellationRequestReceivedCustomer({
    ...common,
    reason: args.reason,
    amountPaidFormatted,
    policy,
    manageUrl,
  });
  const operatorPkg = buildCancellationRequestReceivedOperator({
    ...common,
    reason: args.reason,
    amountPaidFormatted,
    proUrl: proUrlFor(args.tenant, args.lead.id),
  });
  const [customer, operator] = await Promise.all([
    deliver(args.tenant, resolveClientEmailForPaymentMail(args.lead), customerPkg),
    deliver(args.tenant, args.tenant.smtp?.toEmail?.trim() || null, operatorPkg),
  ]);
  return { customer, operator };
}

export async function sendCancellationOutcomeMail(args: {
  tenant: TenantConfig;
  lead: LeadRequest;
  outcome: "accepted" | "cancelled_by_driver" | "refused" | "manual";
  reason?: string | null;
  operatorNote?: string | null;
  refundNote?: string | null;
}): Promise<MailOutcome> {
  const common = await commonFor(args.tenant, args.lead);
  const paid = await paidAmountOf(args.lead);
  const to = resolveClientEmailForPaymentMail(args.lead);
  switch (args.outcome) {
    case "accepted":
      return deliver(args.tenant, to, buildCancellationAcceptedCustomer({ ...common, refundNote: args.refundNote, operatorNote: args.operatorNote }));
    case "cancelled_by_driver":
      return deliver(
        args.tenant,
        to,
        buildCancelledByDriverCustomer({
          ...common,
          reason: args.reason,
          refundNote: args.refundNote,
          amountPaidFormatted: paid ? formatEurCents(paid) : null,
        })
      );
    case "refused":
      return deliver(args.tenant, to, buildCancellationRefusedCustomer({ ...common, operatorNote: args.operatorNote }));
    case "manual":
      return deliver(args.tenant, to, buildCancellationRefusedCustomer({ ...common, operatorNote: args.operatorNote, manual: true }));
  }
}

function failureLabel(code: string | null): string | null {
  switch (code) {
    case "insufficient_funds":
    case "balance_insufficient":
      return "Solde du compte Stripe insuffisant";
    case "charge_for_pending_refund_disputed":
      return "Litige en cours sur le paiement";
    case "expired_or_canceled_card":
    case "lost_or_stolen_card":
      return "Carte du client expirée, annulée ou perdue";
    case "declined":
      return "Remboursement refusé par la banque du client";
    case null:
      return null;
    default:
      return "Refus Stripe";
  }
}

/** Envoie les e-mails de remboursement (client + chauffeur en cas d'échec). Ne lève jamais. */
export class RefundMailNotifier implements RefundNotifier {
  async send(ctx: RefundNotifyContext): Promise<void> {
    const tenant = await resolveTenantConfig(ctx.payment.tenantId);
    if (!tenant) {
      console.warn(`[refund][mail] config tenant introuvable (${ctx.payment.tenantId})`);
      return;
    }
    const lead = await prisma.leadRequest.findFirst({ where: { id: ctx.payment.leadRequestId, tenantId: ctx.payment.tenantId } });
    if (!lead) return;
    const common = await commonFor(tenant, lead);
    const to = resolveClientEmailForPaymentMail(lead);
    const amountFormatted = formatEurCents(ctx.refund.amount);
    const partial = !ctx.fullyRefunded;

    if (ctx.kind === "initiated") {
      await deliver(tenant, to, buildRefundInitiatedCustomer({ ...common, amountFormatted, partial }));
    } else if (ctx.kind === "succeeded") {
      const receipt = await prisma.payment.findUnique({ where: { id: ctx.payment.id }, select: { stripeReceiptUrl: true } });
      await deliver(
        tenant,
        to,
        buildRefundConfirmedCustomer({
          ...common,
          amountFormatted,
          partial,
          totalRefundedFormatted: formatEurCents(ctx.refundedTotal),
          receiptUrl: receipt?.stripeReceiptUrl ?? null,
        })
      );
    } else {
      await deliver(
        tenant,
        tenant.smtp?.toEmail?.trim() || null,
        buildRefundFailedEmail({
          ...common,
          amountFormatted,
          audience: "operator",
          proUrl: proUrlFor(tenant, lead.id),
          reasonLabel: failureLabel(ctx.refund.failureReason),
        })
      );
      await deliver(tenant, to, buildRefundFailedEmail({ ...common, amountFormatted, audience: "customer" }));
    }
  }
}
