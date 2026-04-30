/**
 * Validation des paramètres tenant persistés (JSON).
 *
 * Tests manuels suggérés :
 * - Sans Bearer → GET /api/pro/settings → 401.
 * - Pro connecté avec X-Tenant-ID cohérent → GET → { settings: null, meta.persisted: false } si jamais sauvegardé.
 * - PUT avec objet valide → 200 ; GET suivant → même payload.
 * - PUT avec clé interdite ex. { "SMTP_PASS": "x" } → 400.
 * - PUT avec valeur contenant la sous-chaîne SMTP_PASS dans une valeur string mais clés OK → accepté (filtre sur les noms de clés uniquement).
 */

/** Taille max du JSON sérialisé (UTF-8), sous la limite globale express.json (1 Mo). */
export const TENANT_SETTINGS_MAX_SERIALIZED_BYTES = 512 * 1024;

const FORBIDDEN_KEY_NAMES_LOWER = new Set([
  "smtp_pass",
  "jwt_access_secret",
  "jwt_refresh_secret",
  "distance_matrix_api_key",
  "password",
  "passwordhash",
  "secret",
  "apikey",
]);

export type TenantSettingsValidationFailure = {
  ok: false;
  message: string;
  details?: unknown;
};

export type TenantSettingsValidationSuccess = {
  ok: true;
  /** Copie sérialisable sûre (pas de prototypes exotiques). */
  value: Record<string, unknown>;
};

function collectForbiddenKeyPaths(obj: unknown, pathPrefix: string[]): string[] {
  const violations: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (FORBIDDEN_KEY_NAMES_LOWER.has(key.toLowerCase())) {
        violations.push([...path, key].join("."));
      }
      walk(rec[key], [...path, key]);
    }
  };
  walk(obj, pathPrefix);
  return violations;
}

export function validateTenantSettingsPayload(input: unknown): TenantSettingsValidationSuccess | TenantSettingsValidationFailure {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      message: "Le champ « settings » doit être un objet JSON (pas un tableau ni une valeur primitive).",
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return { ok: false, message: "Impossible de sérialiser « settings » en JSON." };
  }

  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > TENANT_SETTINGS_MAX_SERIALIZED_BYTES) {
    return {
      ok: false,
      message: `« settings » dépasse la taille maximale autorisée (${TENANT_SETTINGS_MAX_SERIALIZED_BYTES} octets).`,
      details: { byteLength },
    };
  }

  const forbiddenPaths = collectForbiddenKeyPaths(input, []);
  if (forbiddenPaths.length > 0) {
    return {
      ok: false,
      message: "Des clés interdites ont été détectées dans « settings ».",
      details: { forbiddenPaths },
    };
  }

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "« settings » JSON invalide après contrôle." };
  }

  return { ok: true, value };
}
