import type { LeadKind, LeadRequest, LeadStatus, Prisma } from "@prisma/client";
import { PaymentStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { trackPlatformEvent } from "../platform/telemetry.service";
import { buildPolicySnapshot, parseStoredPolicy } from "./cancellationPolicy";
import { notifyTenantPush } from "./push";
import { isBlockingStatus, syncLeadOccupation } from "./vehicleAvailability.service";

export type CreateLeadInput = {
  tenantId: string;
  kind: LeadKind;
  status: LeadStatus;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  rawPayload: Prisma.InputJsonValue;
  flatPayload: Prisma.InputJsonValue;
  pricingResult?: Prisma.InputJsonValue;
  sourceSite?: string;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  clientWantsOnlinePayment?: boolean;
  /** Véhicule choisi (référence + snapshot figé du nom, des caractéristiques et du supplément). */
  vehicleId?: string;
  vehicleSnapshot?: Prisma.InputJsonValue;
};

export class RequestService {
  async createLead(input: CreateLeadInput) {
    // Version des conditions d'annulation en vigueur à la réservation (conservée telle quelle ensuite).
    const tenantRow = await prisma.tenant
      .findUnique({ where: { id: input.tenantId }, select: { cancellationPolicy: true } })
      .catch(() => null);
    const policySnapshot = buildPolicySnapshot(parseStoredPolicy(tenantRow?.cancellationPolicy ?? null), "reservation");
    const data: Prisma.LeadRequestUncheckedCreateInput = {
      ...input,
      ...(policySnapshot ? { cancellationPolicySnapshot: policySnapshot as unknown as Prisma.InputJsonValue } : {}),
      rawPayload: input.rawPayload as Prisma.InputJsonValue,
      flatPayload: input.flatPayload as Prisma.InputJsonValue,
      ...(input.pricingResult !== undefined
        ? { pricingResult: input.pricingResult as Prisma.InputJsonValue }
        : {}),
    };
    // Les parcours publics créent toujours des demandes « en attente » (non bloquantes) ; une création directement
    // confirmée (ex. saisie depuis l'espace pro) occupe le véhicule dans la MÊME transaction.
    const created =
      input.vehicleId && isBlockingStatus(input.status)
        ? await prisma.$transaction(async (tx) => {
            const row = await tx.leadRequest.create({ data });
            await syncLeadOccupation(tx, row.id);
            return row;
          })
        : await prisma.leadRequest.create({ data });
    await prisma.leadStatusHistory.create({
      data: {
        leadId: created.id,
        tenantId: created.tenantId,
        newStatus: created.status,
        note: "Création de la demande",
      },
    });
    void trackPlatformEvent({
      tenantId: created.tenantId,
      type: created.kind === "reservation" ? "booking_created" : "quote_request_created",
      category: "business",
      path: "/api",
      metadata: {
        leadId: created.id,
        kind: created.kind,
        status: created.status,
        hasPricingResult: created.pricingResult != null,
      },
    });
    // Tous les appelants sont des parcours publics (contact, devis, réservation).
    notifyTenantPush(created.tenantId, "new_request", created.id);
    return created;
  }

  async markEmailResult(leadId: string, tenantId: string, ok: boolean, error?: string) {
    await prisma.leadRequest.updateMany({
      where: { id: leadId, tenantId },
      data: ok ? { emailSentAt: new Date(), emailError: null } : { emailError: error?.slice(0, 1000) || "Erreur e-mail" },
    });
    void trackPlatformEvent({
      tenantId,
      type: ok ? "email_sent" : "email_failed",
      category: "email",
      path: "/api",
      metadata: {
        leadId,
        ok,
        ...(ok ? {} : { error: (error ?? "Erreur e-mail").slice(0, 200) }),
      },
    });
  }

  async list(tenantId: string, filters: {
    kind?: LeadKind;
    status?: LeadStatus;
    q?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.LeadRequestWhereInput = {
      tenantId,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.q
        ? {
            OR: [
              { clientName: { contains: filters.q, mode: "insensitive" } },
              { clientEmail: { contains: filters.q, mode: "insensitive" } },
              { clientPhone: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return prisma.leadRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async getById(tenantId: string, id: string) {
    return prisma.leadRequest.findFirst({
      where: { id, tenantId },
      include: {
        history: {
          orderBy: { createdAt: "desc" },
          include: {
            changedByUser: { select: { id: true, email: true, role: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            status: true,
            mode: true,
            amount: true,
            currency: true,
            stripePaymentLinkUrl: true,
            stripeReceiptUrl: true,
            stripeCheckoutSessionId: true,
            checkoutExpiresAt: true,
            paidAt: true,
            createdAt: true,
            applicationFeeAmount: true,
            refundedAmount: true,
            applicationFeeRefundedAmount: true,
            refunds: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                amount: true,
                currency: true,
                status: true,
                reason: true,
                failureReason: true,
                initiatedBy: true,
                createdAt: true,
              },
            },
          },
        },
        cancellationRequests: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { id: true, status: true, reason: true, requestedAt: true, resolvedAt: true, resolutionNote: true },
        },
      },
    });
  }

  async updateStatus(params: {
    tenantId: string;
    leadId: string;
    nextStatus: LeadStatus;
    changedByUserId: string;
    note?: string;
  }): Promise<
    | { ok: true; noop: true; lead: LeadRequest }
    | { ok: true; noop: false; lead: LeadRequest; previousStatus: LeadStatus }
    | null
  > {
    const lead = await prisma.leadRequest.findFirst({
      where: { id: params.leadId, tenantId: params.tenantId },
    });
    if (!lead) return null;

    if (lead.status === params.nextStatus) {
      return { ok: true, noop: true, lead };
    }

    const previousStatus = lead.status;
    const now = new Date();
    // Statut + historique + occupation du véhicule dans UNE transaction : si le véhicule est déjà pris ce jour-là
    // (contrainte UNIQUE véhicule/jour), VehicleUnavailableError annule tout et le statut ne change pas.
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.leadRequest.update({
        where: { id: lead.id },
        data: {
          status: params.nextStatus,
          acceptedAt: params.nextStatus === "accepted" ? now : lead.acceptedAt,
          refusedAt: params.nextStatus === "refused" ? now : lead.refusedAt,
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          tenantId: lead.tenantId,
          previousStatus: lead.status,
          newStatus: params.nextStatus,
          changedByUserId: params.changedByUserId,
          note: params.note,
        },
      });
      await syncLeadOccupation(tx, lead.id);
      return row;
    });
    return { ok: true, noop: false, lead: updated, previousStatus };
  }

  async updateNote(params: {
    tenantId: string;
    leadId: string;
    note: string | null;
    changedByUserId: string;
  }) {
    const lead = await prisma.leadRequest.findFirst({
      where: { id: params.leadId, tenantId: params.tenantId },
    });
    if (!lead) return null;

    const updated = await prisma.leadRequest.update({
      where: { id: lead.id },
      data: { operatorNote: params.note },
    });
    await prisma.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId: lead.tenantId,
        previousStatus: lead.status,
        newStatus: lead.status,
        changedByUserId: params.changedByUserId,
        note: "Note opérateur mise à jour",
      },
    });
    return updated;
  }

  async dashboardSummary(tenantId: string) {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      pendingCount,
      newCount,
      acceptedToday,
      upcomingReservationCount,
      recentDevisWeekCount,
      recent,
      stripePaymentsPendingCount,
    ] = await Promise.all([
        prisma.leadRequest.count({
          where: { tenantId, status: { in: ["pending", "new"] } },
        }),
        prisma.leadRequest.count({
          where: { tenantId, status: "new" },
        }),
        prisma.leadRequest.count({
          where: {
            tenantId,
            kind: "reservation",
            status: { in: ["accepted", "scheduled"] },
            scheduledStart: { gte: startToday, lte: endToday },
          },
        }),
        prisma.leadRequest.count({
          where: {
            tenantId,
            kind: "reservation",
            status: { in: ["accepted", "scheduled"] },
            scheduledStart: { gte: now, lte: horizon },
          },
        }),
        prisma.leadRequest.count({
          where: {
            tenantId,
            kind: "devis",
            createdAt: { gte: weekAgo },
          },
        }),
        prisma.leadStatusHistory.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.payment.count({
          where: {
            tenantId,
            status: { in: [PaymentStatus.LINK_SENT, PaymentStatus.PENDING] },
          },
        }),
      ]);

    return {
      pendingCount,
      newCount,
      acceptedToday,
      upcomingReservationCount,
      recentDevisWeekCount,
      stripePaymentsPendingCount,
      recent,
    };
  }

  async calendar(tenantId: string, from: Date, to: Date) {
    return prisma.leadRequest.findMany({
      where: {
        tenantId,
        kind: "reservation",
        status: { in: ["accepted", "scheduled", "completed"] },
        scheduledStart: { gte: from, lte: to },
      },
      orderBy: { scheduledStart: "asc" },
    });
  }
}
