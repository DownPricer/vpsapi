import type { TenantConfig } from "../types/tenant";
import { LeadKind, LeadStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { buildContactPayload } from "../modules/leads/buildLeadRecord";
import { sendContactLeadEmail } from "../modules/email/sendLeadEmails";
import { RequestService } from "./request.service";
import { contactBodySchema } from "../validation/clientBlock";

export interface ContactSuccess {
  leadId: string;
  message: string;
  /** false si l’e-mail opérateur n’a pas pu partir (la demande est quand même enregistrée). */
  emailSent: boolean;
  emailError?: string | null;
}

export class ContactService {
  private requestService = new RequestService();

  async processContact(tenant: TenantConfig, body: Record<string, unknown>): Promise<ContactSuccess> {
    const parsed = contactBodySchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors;
      throw new Error(
        `Données invalides : ${JSON.stringify(msg)}`
      );
    }

    const engine = tenant.pricingEngine;
    const lead = buildContactPayload(
      {
        client: parsed.data.client,
        commentaires: parsed.data.commentaires,
      },
      engine
    );

    const created = await this.requestService.createLead({
      tenantId: tenant.id,
      kind: LeadKind.contact,
      status: LeadStatus.new,
      clientName: `${lead.Prenom} ${lead.Nom}`.trim(),
      clientPhone: lead.Telephone,
      clientEmail: lead.Email,
      rawPayload: body as Prisma.InputJsonValue,
      flatPayload: lead as Prisma.InputJsonValue,
      sourceSite: tenant.branding?.siteUrl,
    });

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendContactLeadEmail(tenant, {
        ...lead,
        LeadId: created.id,
        TypeDemande: "contact",
        Statut: created.status,
        Societe: lead.NomSociete || "",
        DashboardLink: `${process.env.DASHBOARD_BASE_URL || "https://app.sitereadyshd.fr"}/pro/demandes/${created.id}`,
      }, lead.Email);
      await this.requestService.markEmailResult(created.id, tenant.id, true);
    } catch (e) {
      emailSent = false;
      emailError = e instanceof Error ? e.message : String(e);
      await this.requestService.markEmailResult(created.id, tenant.id, false, emailError);
      if (process.env.NODE_ENV === "development") {
        console.error("[vtc-core-api][mail][dev] échec envoi contact opérateur:", emailError);
      }
    }

    return {
      leadId: created.id,
      message: emailSent
        ? "Demande de contact envoyée"
        : "Demande enregistrée — notification e-mail non envoyée (voir back-office).",
      emailSent,
      emailError,
    };
  }
}
