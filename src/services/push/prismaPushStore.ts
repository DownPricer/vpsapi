import { prisma } from "../../db/prisma";
import type { PushStore, StoredPushSubscription, UpsertPushSubscriptionInput } from "./push.types";

export class PrismaPushStore implements PushStore {
  async listForTenant(tenantId: string): Promise<StoredPushSubscription[]> {
    const rows = await prisma.pushSubscription.findMany({
      where: { tenantId, user: { tenantId, active: true } },
      select: { id: true, tenantId: true, userId: true, endpoint: true, p256dh: true, auth: true },
    });
    return rows;
  }

  async upsert(input: UpsertPushSubscriptionInput): Promise<void> {
    const data = {
      tenantId: input.tenantId,
      userId: input.userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
    };
    // `endpoint` est unique globalement : un appareil partagé est réaffecté à l'utilisateur qui se connecte.
    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { ...data, endpoint: input.endpoint },
      update: data,
    });
  }

  async trimUser(tenantId: string, userId: string, keep: number): Promise<number> {
    const stale = await prisma.pushSubscription.findMany({
      where: { tenantId, userId },
      orderBy: { updatedAt: "desc" },
      skip: keep,
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const res = await prisma.pushSubscription.deleteMany({
      where: { tenantId, userId, id: { in: stale.map((s) => s.id) } },
    });
    return res.count;
  }

  async deleteForUser(tenantId: string, userId: string, endpoint: string): Promise<number> {
    const res = await prisma.pushSubscription.deleteMany({ where: { tenantId, userId, endpoint } });
    return res.count;
  }

  async deleteById(tenantId: string, id: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({ where: { tenantId, id } });
  }

  async touch(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.pushSubscription.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { lastUsedAt: new Date() },
    });
  }
}
