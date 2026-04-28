import type { TenantConfig } from "../../types/tenant";
import { buildCustomerConfirmation, buildOperatorEmail } from "./formatLeadEmail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

/** Journal minimal en dev : destinataire opérateur (pas de secrets). */
function logOperatorRecipient(tenant: TenantConfig, context: string): void {
  if (process.env.NODE_ENV !== "development") return;
  const to = tenant.smtp.toEmail?.trim() || "(manquant)";
  console.warn(`[vtc-core-api][mail][dev] ${context} tenant=${tenant.id} opérateur_to=${to}`);
}

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  return fallback;
}

function shouldSendCustomerConfirmation(tenant: TenantConfig): boolean {
  if (typeof tenant.smtp.sendCustomerConfirmation === "boolean") {
    return tenant.smtp.sendCustomerConfirmation;
  }
  return envFlag("MAIL_SEND_CUSTOMER_CONFIRMATION", true);
}

/** Destinataire opérateur : toujours `tenant.smtp.toEmail` (aucun e-mail codé en dur). */
function operatorInbox(tenant: TenantConfig): string {
  const to = tenant.smtp.toEmail?.trim();
  if (!to) {
    throw new Error(`Locataire « ${tenant.id} » : smtp.toEmail est requis pour l’envoi des leads.`);
  }
  return to;
}

export async function sendContactLeadEmail(
  tenant: TenantConfig,
  flat: Record<string, string>,
  replyToCustomerEmail?: string
): Promise<void> {
  const connection = assertSmtpConnection();
  const from = resolveMailFrom(tenant);
  logOperatorRecipient(tenant, "contact");
  const { subject, html, text } = buildOperatorEmail({
    tenant,
    type: "contact",
    subjectPrefix: "",
    flat,
  });
  await sendSmtpMessage({
    connection,
    from,
    to: operatorInbox(tenant),
    subject,
    html,
    text,
    replyTo: replyToCustomerEmail || flat.Email,
  });
}

export async function sendDevisLeadEmails(
  tenant: TenantConfig,
  flat: Record<string, string>,
  customerEmail: string,
  customerDisplayName: string,
  summaryLines: string[]
): Promise<void> {
  const connection = assertSmtpConnection();
  const from = resolveMailFrom(tenant);
  logOperatorRecipient(tenant, "devis");
  const { subject, html, text } = buildOperatorEmail({
    tenant,
    type: "devis",
    subjectPrefix: "[DEVIS] ",
    flat,
  });
  await sendSmtpMessage({
    connection,
    from,
    to: operatorInbox(tenant),
    subject,
    html,
    text,
    replyTo: customerEmail,
  });

  if (shouldSendCustomerConfirmation(tenant) && customerEmail?.includes("@")) {
    const c = buildCustomerConfirmation({
      tenant,
      type: "devis",
      recipientName: customerDisplayName,
      summaryLines,
    });
    await sendSmtpMessage({
      connection,
      from,
      to: customerEmail,
      subject: c.subject,
      html: c.html,
      text: c.text,
      omitAutoBcc: true,
    });
  }
}

export async function sendReservationLeadEmails(
  tenant: TenantConfig,
  flat: Record<string, string>,
  customerEmail: string,
  customerDisplayName: string,
  summaryLines: string[]
): Promise<void> {
  const connection = assertSmtpConnection();
  const from = resolveMailFrom(tenant);
  logOperatorRecipient(tenant, "réservation");
  const { subject, html, text } = buildOperatorEmail({
    tenant,
    type: "reservation",
    subjectPrefix: "[RÉSERVATION] ",
    flat,
  });
  await sendSmtpMessage({
    connection,
    from,
    to: operatorInbox(tenant),
    subject,
    html,
    text,
    replyTo: customerEmail,
  });

  if (shouldSendCustomerConfirmation(tenant) && customerEmail?.includes("@")) {
    const c = buildCustomerConfirmation({
      tenant,
      type: "reservation",
      recipientName: customerDisplayName,
      summaryLines,
    });
    await sendSmtpMessage({
      connection,
      from,
      to: customerEmail,
      subject: c.subject,
      html: c.html,
      text: c.text,
      omitAutoBcc: true,
    });
  }
}
