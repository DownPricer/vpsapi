/**
 * Convertit les photos de véhicules stockées en `data:` URI (base64) — reprises telles quelles par la migration depuis
 * TenantSettings — en vrais fichiers WebP rangés par tenant sous UPLOADS_DIR, puis remplace l'URL en base.
 *
 * Usage : `npm run fleet:convert-base64-photos` (UPLOADS_DIR et DATABASE_URL du .env).
 * `--dry-run` : liste ce qui serait converti sans rien écrire. Idempotent (les photos déjà converties sont ignorées).
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env") });

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { prisma } = await import("../db/prisma");
  const { storeVehiclePhoto } = await import("../modules/fleet/photoStorage");

  const rows = await prisma.vehiclePhoto.findMany({ where: { url: { startsWith: "data:" } } });
  console.log(`${rows.length} photo(s) en base64 trouvée(s)${dry ? " (dry-run)" : ""}.`);
  let converted = 0;
  for (const row of rows) {
    const m = /^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i.exec(row.url);
    if (!m) {
      console.warn(`- ${row.id} : format non pris en charge, ignorée.`);
      continue;
    }
    if (dry) {
      console.log(`- ${row.id} : ${(row.url.length / 1024).toFixed(0)} Ko base64 → serait convertie.`);
      continue;
    }
    try {
      const stored = await storeVehiclePhoto(row.tenantId, Buffer.from(m[1], "base64"));
      await prisma.vehiclePhoto.update({ where: { id: row.id }, data: { url: stored.url } });
      converted += 1;
      console.log(`- ${row.id} → ${stored.url}`);
    } catch (e) {
      console.error(`- ${row.id} : échec (${(e as Error).message}), conservée en base64.`);
    }
  }
  console.log(`${converted} photo(s) convertie(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
