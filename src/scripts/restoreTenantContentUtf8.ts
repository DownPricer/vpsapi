/**
 * Sauvegarde puis restauration UTF-8 du contenu marketing TenantSettings (API distante).
 * Préserve pricing, contact, vehicles, branding.
 *
 * Usage (depuis vtc-core-api) :
 *   RESTORE_API_URL=https://api.sitereadyshd.fr \
 *   RESTORE_TENANT_ID=default \
 *   RESTORE_EMAIL=admin@... \
 *   RESTORE_PASSWORD=... \
 *   npx tsx src/scripts/restoreTenantContentUtf8.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  collectEncodingCorruptionPaths,
  deepRepairEncodingCorruption,
  patchCorruptedStringsFromDefaults,
} from "../utils/tenantSettingsEncoding";

const API_URL = (process.env.RESTORE_API_URL ?? "https://api.sitereadyshd.fr").replace(/\/$/, "");
const TENANT_ID = process.env.RESTORE_TENANT_ID ?? "default";
const EMAIL = process.env.RESTORE_EMAIL ?? process.env.SEED_OPERATOR_EMAIL ?? "";
const PASSWORD = process.env.RESTORE_PASSWORD ?? process.env.SEED_OPERATOR_PASSWORD ?? "";

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

function loadMarketingDefaults(): SettingsRecord {
  const path = join(__dirname, "data", "tenant-marketing-defaults.json");
  return JSON.parse(readFileSync(path, "utf8")) as SettingsRecord;
}

function loadPreservedTextDefaults(): SettingsRecord {
  const path = join(__dirname, "data", "tenant-preserved-text-defaults.json");
  return JSON.parse(readFileSync(path, "utf8")) as SettingsRecord;
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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json; charset=utf-8",
    "X-Tenant-ID": TENANT_ID,
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

function buildRestoredSettings(
  current: SettingsRecord,
  defaults: SettingsRecord,
  preservedTextDefaults: SettingsRecord
): SettingsRecord {
  const restored: SettingsRecord = { ...defaults };

  const pricingTextDefaults = pricingTextDefaultsFromCalculator(defaults.calculatorDisplay);
  restored.pricing = patchCorruptedStringsFromDefaults(
    current.pricing,
    pricingTextDefaults
  ) as SettingsRecord;
  restored.contact = patchCorruptedStringsFromDefaults(
    current.contact,
    preservedTextDefaults.contact
  ) as SettingsRecord;
  restored.vehicles = patchCorruptedStringsFromDefaults(
    current.vehicles,
    preservedTextDefaults.vehicles
  ) as SettingsRecord;
  restored.branding = current.branding;

  const currentGeneral = (current.general ?? {}) as SettingsRecord;
  const defaultGeneral = (defaults.general ?? {}) as SettingsRecord;
  restored.general = {
    ...defaultGeneral,
    commercialName: currentGeneral.commercialName ?? defaultGeneral.commercialName,
    legalName: currentGeneral.legalName ?? defaultGeneral.legalName,
  };

  for (const key of TEXT_SECTIONS) {
    if (defaults[key] !== undefined) restored[key] = defaults[key];
  }

  return restored;
}

async function main(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    console.error("RESTORE_EMAIL et RESTORE_PASSWORD (ou SEED_OPERATOR_*) requis.");
    process.exit(1);
  }

  const marketingDefaults = loadMarketingDefaults();
  const preservedTextDefaults = loadPreservedTextDefaults();
  console.log(`API: ${API_URL} | tenant: ${TENANT_ID}`);

  const login = await api<{
    success: boolean;
    data: { accessToken: string };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const token = login.data.accessToken;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const getRes = await api<{
    success: boolean;
    data: { settings: SettingsRecord | null };
  }>("/pro/settings", { method: "GET", headers: authHeaders });

  const current = getRes.data.settings;
  if (!current) {
    console.error("Aucun settings persisté — rien à restaurer.");
    process.exit(1);
  }

  const backupDir = join(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `tenant-settings-${TENANT_ID}-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(current, null, 2), "utf8");
  console.log(`Sauvegarde : ${backupPath}`);

  const beforePaths = collectEncodingCorruptionPaths(current);
  console.log(`Champs corrompus avant restauration : ${beforePaths.length}`);

  const restored = buildRestoredSettings(current, marketingDefaults, preservedTextDefaults);
  const repaired = deepRepairEncodingCorruption(restored) as SettingsRecord;
  const afterPaths = collectEncodingCorruptionPaths(repaired);
  if (afterPaths.length > 0) {
    console.error("Le payload restauré contient encore des corruptions :", afterPaths.slice(0, 10));
    process.exit(1);
  }

  await api("/pro/settings", {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ settings: repaired }),
  });

  console.log("Settings restaurés (UTF-8) — pricing/contact/vehicles/branding conservés.");

  const pub = await api<{
    success: boolean;
    data: { settings: SettingsRecord };
  }>("/public/tenant-settings", { method: "GET" });

  const pubPaths = collectEncodingCorruptionPaths(pub.data.settings);
  const general = pub.data.settings.general as SettingsRecord | undefined;
  const home = pub.data.settings.home as SettingsRecord | undefined;
  const aboutPreview = (home?.aboutPreview ?? {}) as SettingsRecord;
  const faq = pub.data.settings.faq as SettingsRecord | undefined;
  const faqItems = (faq?.items ?? []) as SettingsRecord[];

  console.log(`Vérification publique : ${pubPaths.length} champ(s) corrompu(s)`);
  console.log(`  tagline: ${general?.tagline}`);
  console.log(`  driver: ${aboutPreview.driverDisplayName}`);
  console.log(`  faq[0]: ${String(faqItems[0]?.answer ?? "").slice(0, 70)}`);

  if (pubPaths.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
