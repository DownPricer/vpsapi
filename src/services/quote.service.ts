import type { TenantConfig } from "../types/tenant";
import { LeadKind, LeadStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { buildDevisPayload } from "../modules/leads/buildLeadRecord";
import { inferScheduleRange } from "../modules/leads/schedule";
import { sendDevisLeadEmails } from "../modules/email/sendLeadEmails";
import { RequestService } from "./request.service";
import { runPricingPipeline } from "./pricing.service";
import { parseClientBlock } from "../validation/clientBlock";

export interface DevisSuccess {
  devisId: string;
  tarif: number;
  message: string;
  emailSent: boolean;
  emailError?: string | null;
}

export class QuoteService {
  private requestService = new RequestService();

  async processDevis(tenant: TenantConfig, body: Record<string, unknown>): Promise<DevisSuccess> {
    const clientParsed = parseClientBlock(body);
    if (!clientParsed.ok) {
      throw new Error(clientParsed.message);
    }

    const { result, distances } = await runPricingPipeline(tenant, body);
    const engine = tenant.pricingEngine;

    const lead = buildDevisPayload({
      payload: body,
      result,
      distances,
      engine,
    });
    const schedule = inferScheduleRange(lead, engine);
    const created = await this.requestService.createLead({
      tenantId: tenant.id,
      kind: LeadKind.devis,
      status: LeadStatus.pending,
      clientName: `${lead.Prenom} ${lead.Nom}`.trim(),
      clientPhone: lead.Telephone,
      clientEmail: lead.Email,
      rawPayload: body as Prisma.InputJsonValue,
      flatPayload: lead as Prisma.InputJsonValue,
      pricingResult: result as unknown as Prisma.InputJsonValue,
      sourceSite: tenant.branding?.siteUrl,
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
    });

    const client = body.client as Record<string, string>;
    const displayName = `${client.prenom} ${client.nom}`.trim();
    const summaryLines = [
      `Référence : ${created.id}`,
      `Tarif estimé : ${result.tarif} €`,
      `Service : ${lead.TypeService || ""}`,
      `Trajet : ${lead.RésuméTrajet || ""}`,
    ];

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendDevisLeadEmails(
        tenant,
        {
          ...lead,
          LeadId: created.id,
          TypeDemande: "devis",
          Statut: created.status,
          Societe: lead.NomSociete || "",
          DashboardLink: `${process.env.DASHBOARD_BASE_URL || "https://app.sitereadyshd.fr"}/pro/demandes/${created.id}`,
        },
        client.email,
        displayName,
        summaryLines
      );
      await this.requestService.markEmailResult(created.id, tenant.id, true);
    } catch (e) {
      emailSent = false;
      emailError = e instanceof Error ? e.message : String(e);
      await this.requestService.markEmailResult(created.id, tenant.id, false, emailError);
      if (process.env.NODE_ENV === "development") {
        console.error("[vtc-core-api][mail][dev] échec envoi devis opérateur:", emailError);
      }
    }

    return {
      devisId: created.id,
      tarif: result.tarif,
      message: emailSent
        ? "Devis envoyé avec succès"
        : "Devis enregistré — notification e-mail non envoyée (voir back-office).",
      emailSent,
      emailError,
    };
  }
}
