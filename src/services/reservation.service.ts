import type { TenantConfig } from "../types/tenant";
import { LeadKind, LeadStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { buildReservationPayload } from "../modules/leads/buildLeadRecord";
import { inferScheduleRange } from "../modules/leads/schedule";
import { sendReservationLeadEmails } from "../modules/email/sendLeadEmails";
import { RequestService } from "./request.service";
import { runPricingPipeline } from "./pricing.service";
import { parseClientBlock } from "../validation/clientBlock";

export interface ReservationSuccess {
  reservationId: string;
  tarif: number;
  message: string;
  emailSent: boolean;
  emailError?: string | null;
}

export class ReservationService {
  private requestService = new RequestService();

  async processReservation(
    tenant: TenantConfig,
    body: Record<string, unknown>
  ): Promise<ReservationSuccess> {
    const clientParsed = parseClientBlock(body);
    if (!clientParsed.ok) {
      throw new Error(clientParsed.message);
    }

    const { result } = await runPricingPipeline(tenant, body);
    const engine = tenant.pricingEngine;

    const paymentMethod =
      (body?.general as Record<string, string>)?.PaymentMethode ||
      (body as Record<string, string>)?.paymentMethod ||
      "N/A";
    const paye =
      (body?.general as Record<string, string>)?.Paye ||
      (body as Record<string, string>)?.paye ||
      "Non";

    const lead = buildReservationPayload({
      payload: body,
      result,
      engine,
      paymentMethod,
      paye,
    });
    const schedule = inferScheduleRange(lead, engine);
    const created = await this.requestService.createLead({
      tenantId: tenant.id,
      kind: LeadKind.reservation,
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
      `Tarif : ${result.tarif} €`,
      `Paiement : ${paye} — ${paymentMethod}`,
      `Trajet : ${lead.RésuméTrajet || ""}`,
    ];

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendReservationLeadEmails(
        tenant,
        {
          ...lead,
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
        console.error("[vtc-core-api][mail][dev] échec envoi réservation opérateur:", emailError);
      }
    }

    return {
      reservationId: created.id,
      tarif: result.tarif,
      message: emailSent
        ? "Réservation envoyée avec succès"
        : "Réservation enregistrée — notification e-mail non envoyée (voir back-office).",
      emailSent,
      emailError,
    };
  }
}
