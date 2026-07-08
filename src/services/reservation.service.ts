import type { TenantConfig } from "../types/tenant";
import { LeadKind, LeadStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { buildReservationPayload } from "../modules/leads/buildLeadRecord";
import { inferScheduleRange } from "../modules/leads/schedule";
import { sendReservationLeadEmails } from "../modules/email/sendLeadEmails";
import { RequestService } from "./request.service";
import { runPricingPipeline } from "./pricing.service";
import type { DistanceUsageContext } from "../modules/distance/distanceMatrix";
import type { PricingDebugBreakdown } from "../modules/pricing/pricingDebugBreakdown";
import { parseClientWantsOnlinePayment } from "../modules/leads/parseClientWantsOnlinePayment";
import { parseClientBlock } from "../validation/clientBlock";

export interface ReservationSuccess {
  reservationId: string;
  tarif: number;
  message: string;
  emailSent: boolean;
  emailError?: string | null;
  pricingDebug?: PricingDebugBreakdown;
}

export class ReservationService {
  private requestService = new RequestService();

  private buildRawPayloadForStorage(
    body: Record<string, unknown>,
    meta: { pricingConfigSource: "tenant_engine" | "payload_pricing_config"; pricingConfigVersion?: string }
  ): Record<string, unknown> {
    if (!("pricingConfig" in body)) return body;
    const { pricingConfig: _ignoredPricingConfig, ...rest } = body;
    return {
      ...rest,
      pricingConfigMeta: {
        source: meta.pricingConfigSource,
        version: meta.pricingConfigVersion ?? "unknown",
      },
    };
  }

  async processReservation(
    tenant: TenantConfig,
    body: Record<string, unknown>,
    includeDebug = false,
    usageContext?: DistanceUsageContext
  ): Promise<ReservationSuccess> {
    const clientParsed = parseClientBlock(body);
    if (!clientParsed.ok) {
      throw new Error(clientParsed.message);
    }

    const { result, pricingDebug, engine, pricingConfigSource, pricingConfigVersion } = await runPricingPipeline(tenant, body, { includeDebug, usageContext });
    const rawPayloadForStorage = this.buildRawPayloadForStorage(body, {
      pricingConfigSource,
      pricingConfigVersion,
    });

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
    const wantsOnline = parseClientWantsOnlinePayment(body);
    const created = await this.requestService.createLead({
      tenantId: tenant.id,
      kind: LeadKind.reservation,
      status: LeadStatus.pending,
      clientName: `${lead.Prenom} ${lead.Nom}`.trim(),
      clientPhone: lead.Telephone,
      clientEmail: lead.Email,
      rawPayload: rawPayloadForStorage as Prisma.InputJsonValue,
      flatPayload: lead as Prisma.InputJsonValue,
      pricingResult: result as unknown as Prisma.InputJsonValue,
      sourceSite: tenant.branding?.siteUrl,
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
      clientWantsOnlinePayment: wantsOnline,
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
          LeadId: created.id,
          TypeDemande: "reservation",
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
      ...(pricingDebug ? { pricingDebug } : {}),
    };
  }
}
