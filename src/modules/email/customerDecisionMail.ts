import type { LeadRequest } from "@prisma/client";
import type { TenantConfig } from "../../types/tenant";
import { prisma } from "../../db/prisma";
import {
  buildCustomerDecisionEmail,
  buildOperatorDecisionEmail,
} from "./formatLeadEmail";
import { assertSmtpConnection, resolveMailFrom, sendSmtpMessage } from "./smtp";

function meaningfulStr(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !["n/a", "na", "null", "undefined", "non renseigne", "0", "0.00", "false", "[]", "{}"].includes(normalized);
}

function pickFlat(flat: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = flat[key];
    if (meaningfulStr(value)) return String(value).trim();
  }
  return "";
}

export function buildDecisionSummaryLines(lead: LeadRequest): string[] {
  const flat = (lead.flatPayload || {}) as Record<string, unknown>;
  const pricing = lead.pricingResult as { tarif?: number } | null | undefined;
  const lines: string[] = [];
  lines.push(`Reference : ${lead.id}`);
  const trajet = pickFlat(flat, ["RésuméTrajet", "ResumeTrajet"]);
  if (trajet) lines.push(`Trajet : ${trajet}`);
  const tarif = pricing?.tarif;
  if (tarif !== undefined && tarif !== null && Number(tarif) > 0) {
    lines.push(
      `Tarif : ${Number(tarif).toLocaleString("fr-FR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })} EUR`
    );
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

export type CustomerDecisionMailResult = {
  attempted: boolean;
  sent: boolean;
  skippedReason?: CustomerDecisionMailSkippedReason;
  error?: string;
  operatorAttempted?: boolean;
  operatorSent?: boolean;
  operatorError?: string;
};

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
  const decisionLabel = lead.status === "accepted" ? "Accepte" : "Refuse";
  const kindLabel = lead.kind === "devis" ? "Devis" : lead.kind === "reservation" ? "Reservation" : "Demande";
  const baseSite = (tenant.branding?.siteUrl || "").replace(/\/$/, "");
  const proUrl = baseSite ? `${baseSite}/pro/demandes/${lead.id}` : "";

  let operatorAttempted = false;
  let operatorSent = false;
  let operatorError = "";

  const operatorEmail = tenant.smtp?.toEmail?.trim();
  if (operatorEmail?.includes("@")) {
    operatorAttempted = true;
    const operatorMail = buildOperatorDecisionEmail({
      tenant,
      leadId: lead.id,
      kindLabel,
      statusLabel: decisionLabel,
      clientName: lead.clientName?.trim() || "Client non renseigne",
      proUrl,
    });
    try {
      await sendSmtpMessage({
        connection,
        from,
        to: operatorEmail,
        subject: operatorMail.subject,
        html: operatorMail.html,
        text: operatorMail.text,
        omitAutoBcc: true,
      });
      operatorSent = true;
    } catch (error) {
      operatorError = error instanceof Error ? error.message : String(error);
      console.error(`[vtc-core-api][mail] echec envoi recap operateur lead=${lead.id}: ${operatorError}`);
    }
  }

  if (lead.kind !== "devis" && lead.kind !== "reservation") {
    return {
      attempted: false,
      sent: false,
      skippedReason: "wrong_kind_or_status",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Echec de l'envoi operateur" : undefined,
    };
  }

  const email = lead.clientEmail?.trim();
  if (!email?.includes("@")) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[vtc-core-api][mail] decision client ignoree : e-mail client absent", lead.id);
    }
    return {
      attempted: false,
      sent: false,
      skippedReason: "no_client_email",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Echec de l'envoi operateur" : undefined,
    };
  }

  const summaryLines = buildDecisionSummaryLines(lead);
  const pkg = buildCustomerDecisionEmail({
    tenant,
    kind: lead.kind === "devis" ? "devis" : "reservation",
    outcome: lead.status === "accepted" ? "accepted" : "refused",
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
      console.info(`[vtc-core-api][mail][dev] decision client envoyee lead=${lead.id}`);
    }
    return {
      attempted: true,
      sent: true,
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Echec de l'envoi operateur" : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.leadRequest.updateMany({
      where: { id: lead.id, tenantId: lead.tenantId },
      data: {
        customerDecisionMailLastError: message.slice(0, 1000),
      },
    });
    console.error(`[vtc-core-api][mail] echec envoi decision client lead=${lead.id}: ${message}`);
    return {
      attempted: true,
      sent: false,
      error: "Echec de l'envoi SMTP",
      operatorAttempted,
      operatorSent,
      operatorError: operatorError ? "Echec de l'envoi operateur" : undefined,
    };
  }
}
