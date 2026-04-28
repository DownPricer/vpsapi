import "dotenv/config";
import bcrypt from "bcryptjs";
import { OperatorRole } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { listTenantConfigs } from "../src/config/tenants/registry";

const prisma = new PrismaClient();

async function main() {
  for (const t of listTenantConfigs()) {
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

  const tenantId = process.env.SEED_OPERATOR_TENANT_ID?.trim();
  const email = process.env.SEED_OPERATOR_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_OPERATOR_PASSWORD?.trim();
  if (tenantId && email && password) {
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
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
