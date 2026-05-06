import type { LeadRequest } from "@prisma/client";
import type { TenantConfig } from "../../types/tenant";
import { buildPaymentLinkCustomerEmail } from "./formatLeadEmail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

function meaningfulStr(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !["n/a", "na", "null", "undefined", "non renseigne"].includes(normalized);
}

function pickFlat(flat: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = flat[key];
    if (meaningfulStr(value)) return String(value).trim();
  }
  return "";
}

/** E-mail client pour le lien de paiement (champ Prisma + cohérence avec les autres mails). */
export function resolveClientEmailForPaymentMail(lead: LeadRequest): string | null {
  const email = lead.clientEmail?.trim();
  if (email?.includes("@")) return email;
  return null;
}

/** Prénom / nom depuis le formulaire, sinon clientName. */
export function paymentLinkClientGreetingName(lead: LeadRequest): string {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  const prenom = pickFlat(flat, ["Prenom", "prenom"]);
  const nom = pickFlat(flat, ["Nom", "nom"]);
  if (prenom || nom) return `${prenom} ${nom}`.trim();
  return lead.clientName?.trim() || "";
}

export function pickVtcPhoneFromTenantSettings(settings: unknown): string | undefined {
  if (settings === null || settings === undefined || typeof settings !== "object" || Array.isArray(settings)) {
    return undefined;
  }
  const o = settings as Record<string, unknown>;
  for (const key of ["phone", "telephone", "companyPhone", "vtcPhone", "tel"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function formatChargeEUR(amountCents: number): string {
  const euros = amountCents / 100;
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: euros % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export type SendPaymentLinkMailResult = {
  sent: boolean;
  errorCode?: string;
};

/**
 * Envoie le lien Checkout au client. Ne modifie pas le Payment (échec SMTP ≠ annulation paiement).
 */
export async function sendPaymentLinkToCustomer(params: {
  tenant: TenantConfig;
  lead: LeadRequest;
  checkoutUrl: string;
  amountCents: number;
  vtcPhone?: string | null;
  vtcEmail?: string | null;
}): Promise<SendPaymentLinkMailResult> {
  const to = resolveClientEmailForPaymentMail(params.lead);
  if (!to) {
    return { sent: false, errorCode: "CLIENT_EMAIL_REQUIRED_FOR_PAYMENT_EMAIL" };
  }

  try {
    const connection = assertSmtpConnection();
    const from = resolveMailFrom(params.tenant);
    const greeting = paymentLinkClientGreetingName(params.lead);
    const pkg = buildPaymentLinkCustomerEmail({
      tenant: params.tenant,
      clientGreetingName: greeting,
      paymentAmountFormatted: formatChargeEUR(params.amountCents),
      checkoutUrl: params.checkoutUrl,
      leadReference: params.lead.id,
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

    if (process.env.NODE_ENV === "development") {
      console.info(`[vtc-core-api][mail][dev] lien paiement envoye lead=${params.lead.id}`);
    }
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      message.includes("SMTP") || message.includes("MAIL_FROM") || message.includes("smtp.")
        ? "SMTP_CONFIGURATION_ERROR"
        : "SMTP_SEND_FAILED";
    console.error(`[vtc-core-api][mail] echec envoi lien paiement lead=${params.lead.id}: ${message}`);
    return { sent: false, errorCode: code };
  }
}
