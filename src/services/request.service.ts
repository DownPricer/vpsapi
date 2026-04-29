import type { LeadKind, LeadRequest, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

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
};

export class RequestService {
  async createLead(input: CreateLeadInput) {
    const created = await prisma.leadRequest.create({
      data: {
        ...input,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
        flatPayload: input.flatPayload as Prisma.InputJsonValue,
        ...(input.pricingResult !== undefined
          ? { pricingResult: input.pricingResult as Prisma.InputJsonValue }
          : {}),
      },
    });
    await prisma.leadStatusHistory.create({
      data: {
        leadId: created.id,
        tenantId: created.tenantId,
        newStatus: created.status,
        note: "Création de la demande",
      },
    });
    return created;
  }

  async markEmailResult(leadId: string, tenantId: string, ok: boolean, error?: string) {
    await prisma.leadRequest.updateMany({
      where: { id: leadId, tenantId },
      data: ok ? { emailSentAt: new Date(), emailError: null } : { emailError: error?.slice(0, 1000) || "Erreur e-mail" },
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
    const updated = await prisma.leadRequest.update({
      where: { id: lead.id },
      data: {
        status: params.nextStatus,
        acceptedAt: params.nextStatus === "accepted" ? now : lead.acceptedAt,
        refusedAt: params.nextStatus === "refused" ? now : lead.refusedAt,
      },
    });
    await prisma.leadStatusHistory.create({
      data: {
        leadId: lead.id,
        tenantId: lead.tenantId,
        previousStatus: lead.status,
        newStatus: params.nextStatus,
        changedByUserId: params.changedByUserId,
        note: params.note,
      },
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

    const [pendingCount, acceptedToday, upcomingReservationCount, recentDevisWeekCount, recent] =
      await Promise.all([
        prisma.leadRequest.count({
          where: { tenantId, status: { in: ["pending", "new"] } },
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
      ]);

    return {
      pendingCount,
      acceptedToday,
      upcomingReservationCount,
      recentDevisWeekCount,
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
