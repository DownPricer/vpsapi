/**
 * Vérifie / recrée l'opérateur pro du tenant default (upsert contrôlé).
 *
 * Usage :
 *   SEED_OPERATOR_EMAIL=admin@... SEED_OPERATOR_PASSWORD=... npm run platform:ensure-operator
 *
 * Options :
 *   ENSURE_OPERATOR_MODE=check — affiche seulement l'état, pas d'écriture
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";

const TENANT_ID = process.env.SEED_OPERATOR_TENANT_ID?.trim() || "default";
const EMAIL = process.env.SEED_OPERATOR_EMAIL?.trim().toLowerCase() || "";
const PASSWORD = process.env.SEED_OPERATOR_PASSWORD?.trim() || "";
const MODE = (process.env.ENSURE_OPERATOR_MODE ?? "upsert").trim().toLowerCase();

async function main(): Promise<void> {
  if (!EMAIL) {
    console.error("SEED_OPERATOR_EMAIL requis.");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true, name: true } });
  if (!tenant) {
    console.error(`Tenant ${TENANT_ID} introuvable.`);
    process.exit(1);
  }

  const existing = await prisma.operatorUser.findFirst({
    where: { tenantId: TENANT_ID, email: EMAIL },
  });

  if (MODE === "check") {
    console.log({
      tenantId: TENANT_ID,
      email: EMAIL,
      exists: Boolean(existing),
      active: existing?.active ?? null,
      role: existing?.role ?? null,
      id: existing?.id ?? null,
    });
    return;
  }

  if (!PASSWORD) {
    console.error("SEED_OPERATOR_PASSWORD requis pour upsert.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  if (existing) {
    await prisma.operatorUser.update({
      where: { id: existing.id },
      data: { passwordHash, active: true, role: "admin" },
    });
    console.log(`Opérateur mis à jour : ${EMAIL} (tenant ${TENANT_ID})`);
  } else {
    await prisma.operatorUser.create({
      data: {
        tenantId: TENANT_ID,
        email: EMAIL,
        passwordHash,
        role: "admin",
        active: true,
      },
    });
    console.log(`Opérateur créé : ${EMAIL} (tenant ${TENANT_ID})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
