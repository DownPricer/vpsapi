/**
 * Vérifie en LECTURE SEULE que les réglages tenant passent validateTenantSettingsPayload.
 * N'écrit rien. N'affiche jamais le contenu des réglages — seulement slug, chemin et règle.
 *
 * Usage :
 *   npx tsx src/scripts/verifyStoredSettings.ts
 *   npx tsx src/scripts/verifyStoredSettings.ts --file chemin.json [--file autre.json]
 *   npm run verify:stored-settings
 */
import { readFileSync, existsSync } from "fs";
import { basename, resolve } from "path";
import { validateTenantSettingsPayload } from "../validation/tenantSettingsPayload";

type Finding = {
  source: string;
  slug: string;
  path: string;
  rule: string;
};

function parseArgs(argv: string[]): { files: string[]; tryDb: boolean } {
  const files: string[] = [];
  let tryDb = true;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) {
      files.push(resolve(argv[++i]!));
    } else if (a === "--no-db") {
      tryDb = false;
    }
  }
  return { files, tryDb };
}

function formatDetails(details: unknown): Array<{ path: string; rule: string }> {
  const out: Array<{ path: string; rule: string }> = [];
  if (details == null) return out;
  if (typeof details === "string") {
    out.push({ path: "(settings)", rule: details });
    return out;
  }
  if (typeof details !== "object") {
    out.push({ path: "(settings)", rule: String(details) });
    return out;
  }
  const d = details as Record<string, unknown>;
  if (Array.isArray(d.forbiddenPaths)) {
    for (const p of d.forbiddenPaths) {
      out.push({ path: String(p), rule: "clé interdite" });
    }
  }
  if (Array.isArray(d.corruptionPaths)) {
    for (const p of d.corruptionPaths) {
      out.push({ path: String(p), rule: "encodage UTF-8 corrompu" });
    }
  }
  if (Array.isArray(d.issues)) {
    for (const issue of d.issues) {
      if (issue && typeof issue === "object") {
        const i = issue as { path?: string; message?: string; code?: string };
        out.push({
          path: i.path ? `pricing.${i.path}` : "settings.pricing",
          rule: i.message || i.code || "règle pricing",
        });
      }
    }
  }
  // Zod flatten / message unique
  if (out.length === 0 && typeof d.message === "string") {
    out.push({ path: "settings.pricing", rule: d.message });
  }
  if (out.length === 0) {
    const keys = Object.keys(d);
    out.push({
      path: keys[0] ? String(keys[0]) : "(settings)",
      rule: "validation échouée (détails non structurés — pas de dump)",
    });
  }
  return out;
}

function validateOne(source: string, slug: string, settings: unknown): Finding[] {
  const result = validateTenantSettingsPayload(settings);
  if (result.ok) return [];
  const parts = formatDetails(result.details);
  if (parts.length === 0) {
    return [{ source, slug, path: "(settings)", rule: result.message }];
  }
  return parts.map((p) => ({
    source,
    slug,
    path: p.path,
    rule: `${result.message} → ${p.rule}`,
  }));
}

function loadJsonFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as unknown;
}

/** Fichiers locaux connus (réglages ou exports) — jamais lus en dump, seulement validés. */
function defaultLocalFiles(): string[] {
  const candidates = [
    "src/scripts/data/tenant-marketing-defaults.json",
    "src/config/tenants/clients/default.json",
    "src/config/tenants/clients/client-demo.json",
  ];
  return candidates.map((c) => resolve(c)).filter((p) => existsSync(p));
}

async function loadFromDatabase(): Promise<Array<{ slug: string; settings: unknown }>> {
  const url = process.env.DATABASE_URL?.trim() || process.env.TEST_DATABASE_URL?.trim();
  if (!url) return [];
  try {
    const { prisma } = await import("../db/prisma");
    const rows = await prisma.tenant.findMany({
      select: { id: true, slug: true, settings: true },
      where: { settings: { not: null } },
    });
    return rows
      .filter((r) => r.settings != null)
      .map((r) => ({ slug: r.slug || r.id, settings: r.settings }));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const { files, tryDb } = parseArgs(process.argv.slice(2));
  const findings: Finding[] = [];
  let checked = 0;

  const fileList = files.length > 0 ? files : defaultLocalFiles();
  for (const path of fileList) {
    const slug = basename(path, ".json");
    try {
      const data = loadJsonFile(path);
      // Fichier « settings » complet, ou enveloppé { settings: ... }
      const settings =
        data && typeof data === "object" && !Array.isArray(data) && "settings" in (data as object)
          ? (data as { settings: unknown }).settings
          : data;
      const f = validateOne(`file:${path}`, slug, settings);
      checked += 1;
      findings.push(...f);
    } catch (e) {
      findings.push({
        source: `file:${path}`,
        slug,
        path: "(file)",
        rule: e instanceof Error ? `lecture impossible: ${e.name}` : "lecture impossible",
      });
    }
  }

  if (tryDb) {
    const rows = await loadFromDatabase();
    if (rows.length === 0) {
      console.log("[verify:stored-settings] Base : aucune ligne settings (ou DB injoignable) — ignorée.");
    } else {
      for (const row of rows) {
        const f = validateOne("database", row.slug, row.settings);
        checked += 1;
        findings.push(...f);
      }
    }
  }

  console.log(`[verify:stored-settings] ${checked} source(s) vérifiée(s).`);
  if (findings.length === 0) {
    console.log("[verify:stored-settings] OK — toutes les configs passent validateTenantSettingsPayload.");
    process.exit(0);
  }

  console.log(`[verify:stored-settings] ÉCHECS : ${findings.length}`);
  for (const f of findings) {
    console.log(`- slug=${f.slug} source=${f.source} path=${f.path} rule=${f.rule}`);
  }
  console.log(
    "\nSi des configs prod échouent : préférer une migration douce (valider seulement les champs pricing modifiés à la save, ou backfill) plutôt que de bloquer tout PUT /settings."
  );
  process.exit(1);
}

void main();
