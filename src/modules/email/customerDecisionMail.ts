import type { LeadRequest } from "@prisma/client";
import type { TenantConfig } from "../../types/tenant";
import { prisma } from "../../db/prisma";
import { buildCustomerDecisionEmail } from "./formatLeadEmail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

function meaningfulStr(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const n = text.toLowerCase();
  return !["n/a", "na", "null", "undefined", "non renseigné", "0", "0.00", "false", "[]", "{}"].includes(n);
}

function pickFlat(flat: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = flat[k];
    if (meaningfulStr(v)) return String(v).trim();
  }
  return "";
}

/** Récap client pour les mails décision (pas de tarif à 0 inutile). */
export function buildDecisionSummaryLines(lead: LeadRequest): string[] {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  const pricing = lead.pricingResult as { tarif?: number } | null | undefined;
  const lines: string[] = [];
  lines.push(`Référence : ${lead.id}`);
  const trajet = pickFlat(flat, ["RésuméTrajet", "ResumeTrajet"]);
  if (trajet) lines.push(`Trajet : ${trajet}`);
  const tarif = pricing?.tarif;
  if (tarif !== undefined && tarif !== null && Number(tarif) > 0) {
    lines.push(`Tarif : ${Number(tarif).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`);
  }
  return lines;
}

function recipientDisplayName(lead: LeadRequest): string {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  const prenom = pickFlat(flat, ["Prenom", "prenom"]);
  const nom = pickFlat(flat, ["Nom", "nom"]);
  if (prenom || nom) return `${prenom} ${nom}`.trim();
  return lead.clientName?.trim() || "Client";
}

export type CustomerDecisionMailSkippedReason = "wrong_kind_or_status" | "no_client_email";

/** Métadonnée renvoyée au dashboard (pas de secrets SMTP). */
export type CustomerDecisionMailResult = {
  attempted: boolean;
  sent: boolean;
  skippedReason?: CustomerDecisionMailSkippedReason;
  error?: string;
  operatorAttempted?: boolean;
  operatorSent?: boolean;
  operatorError?: string;
};

/** Notification au client après acceptation / refus dashboard — ne bloque pas le métier si SMTP échoue. */
export async function sendCustomerDecisionMail(params: {
  tenant: TenantConfig;
  lead: LeadRequest;
}): Promise<CustomerDecisionMailResult> {
  const { tenant, lead } = params;
  if (lead.status !== "accepted" && lead.status !== "refused") {
    return { attempted: false, sent: false, skippedReason: "wrong_kind_or_status" };
  }

  const connection = assertSmtpConnection();
  const from = resolveMailFrom(tenant);
  const decisionLabel = lead.status === "accepted" ? "Accepté" : "Refusé";
  const kindLabel = lead.kind === "devis" ? "Devis" : lead.kind === "reservation" ? "Réservation" : "Demande";
  const baseSite = (tenant.branding?.siteUrl || "").replace(/\/$/, "");
  const proUrl = baseSite ? `${baseSite}/pro/demandes/${lead.id}` : "";

  let operatorAttempted = false;
  let operatorSent = false;
  let operatorError = "";
  const operatorEmail = tenant.smtp?.toEmail?.trim();
  if (operatorEmail?.includes("@")) {
    operatorAttempted = true;
    const subject = `${tenant.company.name} — Demande ${lead.status === "accepted" ? "acceptée" : "refusée"}`;
    const html = `<!DOCTYPE html>
<html lang="fr">
<body style="font-family:Segoe UI,Arial,sans-serif;background:#f7f8fa;padding:20px;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
    <tr><td><h2 style="margin:0 0 14px 0">${lead.status === "accepted" ? "Demande acceptée" : "Demande refusée"}</h2></td></tr>
    <tr><td style="font-size:14px;line-height:1.7">
      <p><strong>Référence :</strong> ${lead.id}</p>
      <p><strong>Client :</strong> ${lead.clientName || "Non renseigné"}</p>
      <p><strong>Type :</strong> ${kindLabel}</p>
      <p><strong>Nouveau statut :</strong> ${decisionLabel}</p>
      ${proUrl ? `<p><a href="${proUrl}" style="color:#ea580c;font-weight:600;text-decoration:none">Ouvrir la demande dans l'espace pro</a></p>` : ""}
    </td></tr>
  </table>
</body>
</html>`;
    const text = [
      `${lead.status === "accepted" ? "Demande acceptée" : "Demande refusée"}`,
      `Référence : ${lead.id}`,
      `Client : ${lead.clientName || "Non renseigné"}`,
      `Type : ${kindLabel}`,
      `Nouveau statut : ${decisionLabel}`,
      proUrl ? `Lien : ${proUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await sendSmtpMessage({
        connection,
        from,
        to: operatorEmail,
        subject,
        html,
        text,
        omitAutoBcc: true,
      });
      operatorSent = true;
    } catch (e) {
      operatorError = e instanceof Error ? e.message : String(e);
      console.error(`[vtc-core-api][mail] échec envoi récap opérateur lead=${lead.id}: ${operatorError}`);
    }
  }

  if (lead.kind !== "devis" && lead.kind !== "reservation") {
    return {
      attempted: false,
      sent: false,
      skippedReason: "wrong_kind_or_status",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Échec de l'envoi opérateur" : undefined,
    };
  }

  const email = lead.clientEmail?.trim();
  if (!email?.includes("@")) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[vtc-core-api][mail] décision client ignorée : e-mail client absent", lead.id);
    }
    return {
      attempted: false,
      sent: false,
      skippedReason: "no_client_email",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Échec de l'envoi opérateur" : undefined,
    };
  }

  const outcome = lead.status === "accepted" ? "accepted" : "refused";
  const summaryLines = buildDecisionSummaryLines(lead);
  const pkg = buildCustomerDecisionEmail({
    tenant,
    kind: lead.kind === "devis" ? "devis" : "reservation",
    outcome,
    recipientName: recipientDisplayName(lead),
    summaryLines,
    operatorNote: lead.operatorNote,
  });

  try {
    await sendSmtpMessage({
      connection,
      from,
      to: email,
      subject: pkg.subject,
      html: pkg.html,
      text: pkg.text,
      omitAutoBcc: true,
    });
    await prisma.leadRequest.updateMany({
      where: { id: lead.id, tenantId: lead.tenantId },
      data: {
        customerDecisionMailSentAt: new Date(),
        customerDecisionMailLastError: null,
      },
    });
    if (process.env.NODE_ENV === "development") {
      console.info(`[vtc-core-api][mail][dev] décision client envoyée lead=${lead.id} outcome=${outcome}`);
    }
    return {
      attempted: true,
      sent: true,
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Échec de l'envoi opérateur" : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.leadRequest.updateMany({
      where: { id: lead.id, tenantId: lead.tenantId },
      data: {
        customerDecisionMailLastError: msg.slice(0, 1000),
      },
    });
    console.error(`[vtc-core-api][mail] échec envoi décision client lead=${lead.id}: ${msg}`);
    return {
      attempted: true,
      sent: false,
      error: "Échec de l'envoi SMTP",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Échec de l'envoi opérateur" : undefined,
    };
  }
}
