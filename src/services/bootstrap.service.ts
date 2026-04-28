import bcrypt from "bcryptjs";
import { OperatorRole } from "@prisma/client";
import { prisma } from "../db/prisma";
import { listTenantConfigs } from "../config/tenants/registry";

export async function syncTenantsToDatabase(): Promise<void> {
  const tenants = listTenantConfigs();
  for (const t of tenants) {
    await prisma.tenant.upsert({
      where: { id: t.id },
      update: {
        name: t.company.name,
        slug: t.id,
        active: true,
        configRef: t.engineRef,
      },
      create: {
        id: t.id,
        name: t.company.name,
        slug: t.id,
        active: true,
        configRef: t.engineRef,
      },
    });
  }
}

export async function seedDefaultOperatorFromEnv(): Promise<void> {
  const tenantId = process.env.SEED_OPERATOR_TENANT_ID?.trim();
  const email = process.env.SEED_OPERATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_OPERATOR_PASSWORD?.trim();
  if (!tenantId || !email || !password) return;

  const hash = await bcrypt.hash(password, 12);
  await prisma.operatorUser.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: {
      passwordHash: hash,
      role: OperatorRole.admin,
      active: true,
    },
    create: {
      tenantId,
      email,
      passwordHash: hash,
      role: OperatorRole.admin,
      active: true,
    },
  });
}
