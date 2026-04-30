/**
 * Nettoyage des paramètres tenant exposés en lecture publique.
 *
 * Tests manuels suggérés :
 * - GET sans row settings en base → `settings: null`, `meta.persisted: false`.
 * - GET avec JSON sauvegardé → objet retourné, `meta.persisted: true`.
 * - Vérifier qu’aucune clé interdite n’apparaît dans la réponse (SMTP_PASS, JWT_*, DISTANCE_MATRIX_API_KEY, etc.).
 * - Vérifier l’absence de `operatorExtraRecipientEmail` (y compris sous `emails`).
 * - Résolution tenant via `X-Tenant-ID` (middleware existant).
 */

const FORBIDDEN_SECRET_KEYS_LOWER = new Set([
  "smtp_pass",
  "jwt_access_secret",
  "jwt_refresh_secret",
  "distance_matrix_api_key",
  "password",
  "passwordhash",
  "secret",
  "apikey",
]);

/** Champs e-mail / routage internes à ne jamais exposer sur l’endpoint public. */
const INTERNAL_EMAIL_FIELD_KEYS_LOWER = new Set([
  "operatorextracipientemail",
  "mail_to",
  "mail_to_copy",
  "mail_reply_to",
  "mailbcc",
  "mailbccinternal",
  "internalroutingemail",
  "operatorinbox",
]);

function shouldStripKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (FORBIDDEN_SECRET_KEYS_LOWER.has(lower)) return true;
  if (INTERNAL_EMAIL_FIELD_KEYS_LOWER.has(lower)) return true;
  return false;
}

function stripNode(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripNode);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (shouldStripKey(k)) continue;
    out[k] = stripNode(v);
  }
  return out;
}

/**
 * Retourne une copie profonde sans clés sensibles ni champs e-mail internes.
 * Si la racine n’est pas un objet JSON, retourne `null`.
 */
export function sanitizePublicTenantSettings(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const clone = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    return stripNode(clone) as Record<string, unknown>;
  } catch {
    return null;
  }
}
