import { stringLooksEncodingCorrupted } from "../utils/tenantSettingsEncoding";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function walkStrings(value: unknown, path: string, out: Array<{ path: string; value: string }>, depth = 0): void {
  if (depth > 6) return;
  if (typeof value === "string") {
    out.push({ path, value });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(30, value.length); i += 1) {
      walkStrings(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return;
  }
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    walkStrings(v, path ? `${path}.${k}` : k, out, depth + 1);
  }
}

const CORRUPTED_PATTERNS: Array<{ id: string; re: RegExp }> = [
  // IMPORTANT: pas de /g ici (évite lastIndex et diagnostics incohérents).
  { id: "replacement_char", re: /�/ },
  { id: "utf8_mojibake_ae", re: /Ã©/ },
  { id: "utf8_mojibake_egrave", re: /Ã¨/ },
  { id: "utf8_mojibake_ecirc", re: /Ãª/ },
  { id: "utf8_mojibake_generic", re: /Ã[a-zA-Z]/ },
  { id: "accent_replaced_by_question_mark", re: /\p{L}\?\p{L}|\p{L}\?(?=\s|$)/u },
];

const PLACEHOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "exemple", re: /\bExemple\b/i },
  { id: "adresse_a_completer", re: /Adresse à compléter/i },
  { id: "cp_ville", re: /\b00000\b/i },
  { id: "ville_exemple", re: /Ville exemple/i },
  { id: "nouveau_vehicule", re: /Nouveau véhicule/i },
  { id: "test_domain", re: /test-vtc\.example\.com/i },
  { id: "jean_test", re: /Jean Test/i },
];

export type TenantAuditResult = {
  corruptedTextFieldsCount: number;
  corruptedSamples: Array<{ path: string; sample: string; pattern: string }>;
  placeholderFieldsCount: number;
  placeholderSamples: Array<{ path: string; sample: string; pattern: string }>;
  missingRequiredFields: string[];
  warnings: string[];
  readinessScore: number;
  checks: Array<{
    id: string;
    label: string;
    status: "ok" | "warning" | "ko";
    severity: "info" | "warning" | "critique";
    message?: string;
  }>;
  issues: Array<{
    severity: "info" | "warning" | "critique";
    title: string;
    message: string;
  }>;
};

export function auditTenantContent(tenantSettings: unknown): TenantAuditResult {
  const strings: Array<{ path: string; value: string }> = [];
  walkStrings(tenantSettings, "", strings);

  const corruptedSamples: TenantAuditResult["corruptedSamples"] = [];
  const placeholderSamples: TenantAuditResult["placeholderSamples"] = [];

  let corruptedCount = 0;
  let placeholderCount = 0;

  for (const s of strings) {
    for (const p of CORRUPTED_PATTERNS) {
      if (p.re.test(s.value) || (p.id === "accent_replaced_by_question_mark" && stringLooksEncodingCorrupted(s.value))) {
        corruptedCount += 1;
        if (corruptedSamples.length < 20) {
          corruptedSamples.push({ path: s.path, sample: s.value.slice(0, 140), pattern: p.id });
        }
        break;
      }
    }
    for (const p of PLACEHOLDER_PATTERNS) {
      if (p.re.test(s.value)) {
        placeholderCount += 1;
        if (placeholderSamples.length < 20) {
          placeholderSamples.push({ path: s.path, sample: s.value.slice(0, 140), pattern: p.id });
        }
        break;
      }
    }
  }

  // Schéma réel (front) : TenantSettingsV1.
  // On tolère des variantes (anciens chemins) pour éviter les faux "manquants".
  const required: Array<{ paths: string[]; label: string }> = [
    { paths: ["general.commercialName", "general.name", "branding.name", "company.name"], label: "Nom commercial" },
    { paths: ["contact.emailPublic", "contact.email", "company.email"], label: "Email public" },
    { paths: ["contact.phoneE164", "contact.phoneDisplay", "contact.phone"], label: "Téléphone" },
    { paths: ["contact.address.street", "contact.addressLine1", "company.address.street"], label: "Adresse (rue)" },
    { paths: ["contact.address.postalCode", "contact.postalCode", "company.address.postalCode"], label: "Code postal" },
    { paths: ["contact.address.city", "contact.city", "company.address.city"], label: "Ville" },
    { paths: ["branding.logoSrc", "branding.logo", "branding.logoUrl"], label: "Logo" },
  ];

  function getByPath(root: unknown, path: string): unknown {
    if (!root || typeof root !== "object") return undefined;
    const parts = path.split(".");
    let cur: any = root;
    for (const p of parts) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }

  const missingRequiredFields: string[] = [];
  for (const r of required) {
    const found = r.paths.some((p) => {
      const v = getByPath(tenantSettings, p);
      if (typeof v === "string") return v.trim().length > 0;
      // Tolère l’objet adresse etc.
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return true;
      return false;
    });
    if (!found) missingRequiredFields.push(r.label);
  }

  const warnings: string[] = [];
  if (corruptedCount > 0) warnings.push("Textes potentiellement corrompus (encodage) détectés.");
  if (placeholderCount > 0) warnings.push("Textes de template/placeholder détectés.");
  if (missingRequiredFields.length > 0) warnings.push("Champs requis manquants.");

  const checks: TenantAuditResult["checks"] = [];
  const issues: TenantAuditResult["issues"] = [];

  // Checks “dirigeant” (V2)
  checks.push({
    id: "identity_required",
    label: "Identité (nom, email, téléphone, URL)",
    status: missingRequiredFields.length === 0 ? "ok" : "ko",
    severity: missingRequiredFields.length === 0 ? "info" : "critique",
    ...(missingRequiredFields.length > 0 ? { message: `Champs manquants: ${missingRequiredFields.slice(0, 3).join(", ")}${missingRequiredFields.length > 3 ? "…" : ""}` } : {}),
  });
  checks.push({
    id: "encoding",
    label: "Accents / encodage",
    status: corruptedCount === 0 ? "ok" : "warning",
    severity: corruptedCount === 0 ? "info" : "warning",
    ...(corruptedCount > 0 ? { message: `${corruptedCount} champ(s) suspect(s)` } : {}),
  });
  checks.push({
    id: "placeholders",
    label: "Texte template (Exemple, adresse à compléter…)",
    status: placeholderCount === 0 ? "ok" : "warning",
    severity: placeholderCount === 0 ? "info" : "warning",
    ...(placeholderCount > 0 ? { message: `${placeholderCount} occurrence(s)` } : {}),
  });

  if (missingRequiredFields.length > 0) {
    issues.push({
      severity: "critique",
      title: "Champs requis manquants",
      message: missingRequiredFields.slice(0, 6).join(" · ") + (missingRequiredFields.length > 6 ? " …" : ""),
    });
  }
  if (placeholderCount > 0) {
    issues.push({
      severity: "warning",
      title: "Textes de template détectés",
      message: placeholderSamples.slice(0, 3).map((s) => `${s.path}: ${s.sample}`).join(" · "),
    });
  }
  if (corruptedCount > 0) {
    issues.push({
      severity: "warning",
      title: "Accents/encodage suspects",
      message: corruptedSamples.slice(0, 3).map((s) => `${s.path}: ${s.sample}`).join(" · "),
    });
  }

  // Score V1 : pénalités simples (extensible).
  let score = 100;
  score -= Math.min(40, corruptedCount * 5);
  score -= Math.min(30, placeholderCount * 3);
  score -= Math.min(40, missingRequiredFields.length * 10);
  if (score < 0) score = 0;

  return {
    corruptedTextFieldsCount: corruptedCount,
    corruptedSamples,
    placeholderFieldsCount: placeholderCount,
    placeholderSamples,
    missingRequiredFields,
    warnings,
    readinessScore: score,
    checks,
    issues,
  };
}

