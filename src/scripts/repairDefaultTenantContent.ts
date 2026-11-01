/**
 * Sauvegarde puis réparation UTF-8 du contenu tenant (texte marketing / véhicules / contact).
 * Préserve pricing, branding, Stripe, noms commerciaux.
 *
 * Usage (API distante, ex. production) :
 *   RESTORE_API_URL=https://api.sitereadyshd.fr \
 *   RESTORE_TENANT_ID=default \
 *   RESTORE_EMAIL=admin@... \
 *   RESTORE_PASSWORD=... \
 *   npm run tenant:repair-default-content
 *
 * Usage (base locale Prisma, DATABASE_URL dans .env) :
 *   REPAIR_MODE=db npm run tenant:repair-default-content
 *
 * Options :
 *   REPAIR_DRY_RUN=1 — audit seulement, pas d'écriture
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  collectEncodingCorruptionPaths,
  deepPatchCorruptedFromDefaults,
  deepRepairEncodingCorruption,
  patchCorruptedStringsFromDefaults,
  stringLooksEncodingCorrupted,
} from "../utils/tenantSettingsEncoding";

const MODE = (process.env.REPAIR_MODE ?? "api").trim().toLowerCase();
const API_URL = (process.env.RESTORE_API_URL ?? process.env.REPAIR_API_URL ?? "https://api.sitereadyshd.fr").replace(
  /\/$/,
  ""
);
const TENANT_ID = process.env.RESTORE_TENANT_ID ?? process.env.REPAIR_TENANT_ID ?? "default";
const EMAIL = process.env.RESTORE_EMAIL ?? process.env.SEED_OPERATOR_EMAIL ?? "";
const PASSWORD = process.env.RESTORE_PASSWORD ?? process.env.SEED_OPERATOR_PASSWORD ?? "";
const DRY_RUN = ["1", "true", "yes"].includes((process.env.REPAIR_DRY_RUN ?? "").trim().toLowerCase());

const TEXT_SECTIONS = [
  "home",
  "faq",
  "services",
  "aboutPage",
  "testimonials",
  "contactPage",
  "thanksPage",
  "pricingDisplay",
  "calculatorDisplay",
  "badges",
  "seo",
  "legal",
] as const;

type SettingsRecord = Record<string, unknown>;

function loadJson(path: string): SettingsRecord {
  return JSON.parse(readFileSync(path, "utf8")) as SettingsRecord;
}

function loadMarketingDefaults(): SettingsRecord {
  return loadJson(join(__dirname, "data", "tenant-marketing-defaults.json"));
}

function loadPreservedTextDefaults(): SettingsRecord {
  return loadJson(join(__dirname, "data", "tenant-preserved-text-defaults.json"));
}

function deepMerge(base: SettingsRecord, overlay: SettingsRecord): SettingsRecord {
  const out: SettingsRecord = { ...base };
  for (const [key, val] of Object.entries(overlay)) {
    if (val && typeof val === "object" && !Array.isArray(val) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key] as SettingsRecord, val as SettingsRecord);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function pricingTextDefaultsFromCalculator(calculatorDisplay: unknown): SettingsRecord {
  const calc = (calculatorDisplay ?? {}) as SettingsRecord;
  const airports = (calc.airports ?? []) as SettingsRecord[];
  return {
    airportTransfers: {
      airports: airports.map((a) => ({
        code: a.code,
        name: a.label ?? a.code,
        address: a.address,
      })),
    },
  };
}

function repairVehiclesSection(current: unknown, defaults: unknown): SettingsRecord {
  const cur = (current ?? {}) as SettingsRecord;
  const def = (defaults ?? {}) as SettingsRecord;
  const patched = deepPatchCorruptedFromDefaults(cur, def) as SettingsRecord;
  if (collectEncodingCorruptionPaths(patched).length === 0) return patched;

  const curItems = Array.isArray(cur.items) ? (cur.items as SettingsRecord[]) : [];
  const defItems = Array.isArray(def.items) ? (def.items as SettingsRecord[]) : [];
  const items = curItems.map((item, i) => {
    const defItem = defItems[i] ?? defItems[0] ?? {};
    const merged = deepPatchCorruptedFromDefaults(item, defItem) as SettingsRecord;
    if (collectEncodingCorruptionPaths(merged).length > 0) {
      return {
        ...defItem,
        id: item.id ?? defItem.id,
        name: stringLooksEncodingCorrupted(String(item.name ?? "")) ? defItem.name : item.name,
        enabled: item.enabled ?? defItem.enabled,
        featured: item.featured ?? defItem.featured,
        heroImageSrc: item.heroImageSrc ?? defItem.heroImageSrc,
        gallery: deepPatchCorruptedFromDefaults(item.gallery, defItem.gallery),
      } as SettingsRecord;
    }
    return merged;
  });

  const featured = deepPatchCorruptedFromDefaults(cur.featured, def.featured) as SettingsRecord;
  const featuredClean =
    collectEncodingCorruptionPaths(featured).length > 0
      ? {
          ...(def.featured as SettingsRecord),
          id: (cur.featured as SettingsRecord | undefined)?.id,
          name: (cur.featured as SettingsRecord | undefined)?.name,
          passengerMax: (cur.featured as SettingsRecord | undefined)?.passengerMax,
          gallery: deepPatchCorruptedFromDefaults(
            (cur.featured as SettingsRecord | undefined)?.gallery,
            (def.featured as SettingsRecord | undefined)?.gallery
          ),
        }
      : featured;

  return {
    ...patched,
    featuredVehicleId: cur.featuredVehicleId ?? def.featuredVehicleId,
    featured: featuredClean,
    items: items.length ? items : def.items,
  };
}

function buildRepairedSettings(current: SettingsRecord): { repaired: SettingsRecord; fieldsFixed: number } {
  const marketingDefaults = loadMarketingDefaults();
  const preservedTextDefaults = loadPreservedTextDefaults();
  const textDefaults = deepMerge(marketingDefaults, preservedTextDefaults);

  const beforePaths = collectEncodingCorruptionPaths(current);

  let repaired: SettingsRecord = { ...current };

  const currentGeneral = (current.general ?? {}) as SettingsRecord;
  const defaultGeneral = (textDefaults.general ?? {}) as SettingsRecord;
  repaired.general = {
    ...deepPatchCorruptedFromDefaults(currentGeneral, defaultGeneral),
    commercialName: currentGeneral.commercialName ?? defaultGeneral.commercialName,
    legalName: currentGeneral.legalName ?? defaultGeneral.legalName,
  };

  for (const key of TEXT_SECTIONS) {
    if (textDefaults[key] === undefined) continue;
    const section = current[key];
    const sectionPaths = collectEncodingCorruptionPaths(section);
    if (sectionPaths.length > 0) {
      repaired[key] = textDefaults[key];
    } else if (section !== undefined) {
      repaired[key] = deepPatchCorruptedFromDefaults(section, textDefaults[key]);
    } else {
      repaired[key] = textDefaults[key];
    }
  }

  const pricingTextDefaults = pricingTextDefaultsFromCalculator(textDefaults.calculatorDisplay);
  repaired.pricing = patchCorruptedStringsFromDefaults(current.pricing, pricingTextDefaults) as SettingsRecord;
  repaired.contact = deepPatchCorruptedFromDefaults(current.contact ?? {}, textDefaults.contact ?? {});
  repaired.vehicles = repairVehiclesSection(current.vehicles, textDefaults.vehicles ?? {});
  repaired.branding = current.branding;

  repaired = deepRepairEncodingCorruption(repaired) as SettingsRecord;

  const afterPaths = collectEncodingCorruptionPaths(repaired);
  return { repaired, fieldsFixed: beforePaths.length - afterPaths.length };
}

function writeBackup(current: SettingsRecord): string {
  const backupDir = join(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `tenant-settings-${TENANT_ID}-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(current, null, 2), "utf8");
  return backupPath;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json; charset=utf-8",
    "X-Tenant-ID": TENANT_ID,
    "X-Site-Domain": "vtc.sitereadyshd.fr",
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  const json = (await res.json()) as T & { success?: boolean; error?: { message?: string } };
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(`${path} → ${res.status} ${msg}`);
  }
  return json;
}

async function loadCurrentFromApi(): Promise<SettingsRecord> {
  if (!EMAIL || !PASSWORD) {
    throw new Error("RESTORE_EMAIL et RESTORE_PASSWORD (ou SEED_OPERATOR_*) requis en mode api.");
  }
  const login = await api<{ data: { accessToken: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const authHeaders = { Authorization: `Bearer ${login.data.accessToken}` };
  const getRes = await api<{ data: { settings: SettingsRecord | null } }>("/pro/settings", {
    method: "GET",
    headers: authHeaders,
  });
  if (!getRes.data.settings) throw new Error("Aucun settings persisté — rien à réparer.");
  return getRes.data.settings;
}

async function saveViaApi(repaired: SettingsRecord): Promise<void> {
  const login = await api<{ data: { accessToken: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  await api("/pro/settings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${login.data.accessToken}` },
    body: JSON.stringify({ settings: repaired }),
  });
}

async function loadCurrentFromDb(): Promise<SettingsRecord> {
  const row = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { settings: true } });
  if (!row?.settings || typeof row.settings !== "object") {
    throw new Error(`Tenant ${TENANT_ID} introuvable ou sans settings.`);
  }
  return row.settings as SettingsRecord;
}

async function saveViaDb(repaired: SettingsRecord): Promise<void> {
  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { settings: repaired as Prisma.InputJsonValue },
  });
}

async function verifyPublicApi(): Promise<number> {
  const pub = await api<{ data: { settings: SettingsRecord } }>("/public/tenant-settings", { method: "GET" });
  const paths = collectEncodingCorruptionPaths(pub.data.settings);
  const general = pub.data.settings.general as SettingsRecord | undefined;
  const home = pub.data.settings.home as SettingsRecord | undefined;
  const aboutPreview = (home?.aboutPreview ?? {}) as SettingsRecord;
  console.log(`Vérification publique : ${paths.length} champ(s) corrompu(s)`);
  console.log(`  tagline: ${general?.tagline}`);
  console.log(`  driver: ${aboutPreview.driverDisplayName}`);
  console.log(`  roleLabel: ${aboutPreview.roleLabel}`);
  return paths.length;
}

async function main(): Promise<void> {
  console.log(`Mode: ${MODE} | tenant: ${TENANT_ID}${DRY_RUN ? " | DRY RUN" : ""}`);

  const current = MODE === "db" ? await loadCurrentFromDb() : await loadCurrentFromApi();
  const beforeCount = collectEncodingCorruptionPaths(current).length;
  console.log(`Champs corrompus avant réparation : ${beforeCount}`);
  if (beforeCount === 0) {
    console.log("Rien à réparer.");
    if (MODE === "api") await verifyPublicApi();
    return;
  }

  const backupPath = writeBackup(current);
  console.log(`Sauvegarde : ${backupPath}`);

  const { repaired, fieldsFixed } = buildRepairedSettings(current);
  const afterCount = collectEncodingCorruptionPaths(repaired).length;
  console.log(`Champs corrompus après réparation : ${afterCount}`);
  console.log(`Champs corrigés (delta audit) : ${fieldsFixed}`);

  if (afterCount > 0) {
    console.error("Le payload réparé contient encore des corruptions :", collectEncodingCorruptionPaths(repaired).slice(0, 15));
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("DRY RUN — aucune écriture effectuée.");
    return;
  }

  if (MODE === "db") {
    await saveViaDb(repaired);
    console.log("Settings réparés en base locale.");
  } else {
    await saveViaApi(repaired);
    console.log(`Settings réparés via API (${API_URL}).`);
    const remaining = await verifyPublicApi();
    if (remaining > 0) process.exit(1);
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
