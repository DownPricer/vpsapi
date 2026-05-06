import type { LeadRequest, Payment } from "@prisma/client";
import { PaymentMode, PaymentStatus } from "@prisma/client";
import { getTenantConfig } from "../../config/tenants/registry";
import { prisma } from "../../db/prisma";
import type { TenantConfig } from "../../types/tenant";
import {
  buildPaymentConfirmationCustomerEmail,
  buildPaymentConfirmationOperatorEmail,
} from "./formatLeadEmail";
import {
  paymentLinkClientGreetingName,
  pickVtcPhoneFromTenantSettings,
  resolveClientEmailForPaymentMail,
} from "./paymentLinkMail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

function formatAmountEur(amountCents: number): string {
  const euros = amountCents / 100;
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: euros % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function paymentModeLabel(mode: PaymentMode): string {
  return mode === PaymentMode.FULL ? "Paiement intégral" : "Acompte";
}

function tripSummaryFromLead(lead: LeadRequest): string | undefined {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  for (const key of ["RésuméTrajet", "ResumeTrajet"]) {
    const v = flat[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function proDashboardUrl(tenantSiteUrl: string | undefined, leadId: string): string | undefined {
  const base = tenantSiteUrl?.trim().replace(/\/$/, "");
  return base ? `${base}/pro/demandes/${leadId}` : undefined;
}

/**
 * Envoi client après paiement OK — ne lève pas ; logs sobres si échec ou e-mail absent.
 */
export async function sendPaymentConfirmationToCustomer(params: {
  tenant: TenantConfig;
  lead: LeadRequest;
  payment: Payment;
  vtcPhone?: string | null;
  vtcEmail?: string | null;
}): Promise<void> {
  try {
    const to = resolveClientEmailForPaymentMail(params.lead);
    if (!to) {
      console.warn(
        `[stripe-webhook][mail] confirmation client ignorée : pas d'e-mail client (lead=${params.lead.id})`
      );
      return;
    }

    const connection = assertSmtpConnection();
    const from = resolveMailFrom(params.tenant);
    const greetingName = paymentLinkClientGreetingName(params.lead);
    const pkg = buildPaymentConfirmationCustomerEmail({
      tenant: params.tenant,
      clientName: greetingName || params.lead.clientName?.trim() || "",
      amountFormatted: formatAmountEur(params.payment.amount),
      leadReference: params.lead.id,
      tripSummary: tripSummaryFromLead(params.lead),
      vtcPhone: params.vtcPhone,
      vtcEmail: params.vtcEmail,
    });

    await sendSmtpMessage({
      connection,
      from,
      to,
      subject: pkg.subject,
      html: pkg.html,
      text: pkg.text,
      omitAutoBcc: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[stripe-webhook][mail] échec envoi confirmation client (lead=${params.lead.id}) : ${msg}`
    );
  }
}

/**
 * Envoi opérateur (`smtp.toEmail`) — ne lève pas.
 */
export async function sendPaymentConfirmationToOperator(params: {
  tenant: TenantConfig;
  lead: LeadRequest;
  payment: Payment;
}): Promise<void> {
  try {
    const to = params.tenant.smtp?.toEmail?.trim();
    if (!to?.includes("@")) {
      console.warn(
        `[stripe-webhook][mail] confirmation opérateur ignorée : smtp.toEmail manquant (tenant=${params.tenant.id})`
      );
      return;
    }

    const connection = assertSmtpConnection();
    const from = resolveMailFrom(params.tenant);
    const proUrl = proDashboardUrl(params.tenant.branding?.siteUrl, params.lead.id);
    const clientDisplay =
      params.lead.clientName?.trim() ||
      paymentLinkClientGreetingName(params.lead) ||
      "Client";

    const pkg = buildPaymentConfirmationOperatorEmail({
      tenant: params.tenant,
      amountFormatted: formatAmountEur(params.payment.amount),
      clientName: clientDisplay,
      leadReference: params.lead.id,
      paymentModeLabel: paymentModeLabel(params.payment.mode),
      proUrl,
    });

    await sendSmtpMessage({
      connection,
      from,
      to,
      subject: pkg.subject,
      html: pkg.html,
      text: pkg.text,
      omitAutoBcc: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[stripe-webhook][mail] échec envoi confirmation opérateur (lead=${params.lead.id}) : ${msg}`
    );
  }
}

/**
 * Charge les entités après passage en PAID et envoie les confirmations (ne lève pas).
 */
export async function notifyPaymentConfirmedAfterWebhookTransition(params: {
  tenantId: string;
  leadRequestId: string;
  paymentId: string;
}): Promise<void> {
  try {
    const [payment, lead, tenantRow] = await Promise.all([
      prisma.payment.findFirst({
        where: {
          id: params.paymentId,
          tenantId: params.tenantId,
          leadRequestId: params.leadRequestId,
        },
      }),
      prisma.leadRequest.findFirst({
        where: { id: params.leadRequestId, tenantId: params.tenantId },
      }),
      prisma.tenant.findUnique({
        where: { id: params.tenantId },
        select: { settings: true },
      }),
    ]);

    if (!payment || payment.status !== PaymentStatus.PAID || !lead) {
      return;
    }

    const tenantCfg = getTenantConfig(params.tenantId);
    if (!tenantCfg) {
      console.warn(
        `[stripe-webhook][mail] confirmation ignorée : config tenant introuvable (${params.tenantId})`
      );
      return;
    }

    const vtcPhone = pickVtcPhoneFromTenantSettings(tenantRow?.settings ?? null) ?? null;
    const vtcEmailForCustomer = tenantCfg.smtp?.toEmail?.trim() || null;

    await sendPaymentConfirmationToCustomer({
      tenant: tenantCfg,
      lead,
      payment,
      vtcPhone,
      vtcEmail: vtcEmailForCustomer,
    });

    await sendPaymentConfirmationToOperator({
      tenant: tenantCfg,
      lead,
      payment,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[stripe-webhook][mail] notify confirmation : ${msg}`);
  }
}
