import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export type TenantSettingsRowState =
  | { tenantExists: false }
  | { tenantExists: true; settings: unknown | null };

export class TenantSettingsService {
  async getSettingsState(tenantId: string): Promise<TenantSettingsRowState> {
    const row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!row) return { tenantExists: false };
    return { tenantExists: true, settings: row.settings };
  }

  async saveSettings(tenantId: string, settings: Prisma.InputJsonValue): Promise<void> {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings },
    });
  }
}
