/**
 * Détection d'accents cassés :
 * - U+FFFD () : octets UTF-8 perdus
 * - mojibake « Ã© », « Ã¨ »…
 * - « ? » entre lettres (ex. priv?, Bas?s) — pas les « ? » légitimes en fin de phrase.
 */
const CORRUPTED_FRENCH_PATTERN = /\p{L}\?\p{L}|\p{L}\?(?=\s|$)/u;
const MOJIBAKE_PATTERN = /Ã[\u0080-\u00BF]|â[\u0080-\u00BF]|ï¿½/;

function isLikelyUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed);
}

export function stringLooksEncodingCorrupted(value: string): boolean {
  if (value.includes("\uFFFD")) return true;
  if (MOJIBAKE_PATTERN.test(value)) return true;
  if (!value.includes("?")) return false;
  if (isLikelyUrl(value)) return false;
  return CORRUPTED_FRENCH_PATTERN.test(value);
}

/** Remplace uniquement les chaînes corrompues par leur équivalent UTF-8 dans `defaults` (même structure). */
export function patchCorruptedStringsFromDefaults<T>(current: T, defaults: T): T {
  if (typeof current === "string") {
    if (
      typeof defaults === "string" &&
      stringLooksEncodingCorrupted(current) &&
      !stringLooksEncodingCorrupted(defaults)
    ) {
      return defaults;
    }
    return current;
  }
  if (
    current === null ||
    defaults === null ||
    typeof current !== "object" ||
    typeof defaults !== "object"
  ) {
    return current;
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(defaults)) return current;
    return current.map((item, i) =>
      patchCorruptedStringsFromDefaults(item, defaults[i])
    ) as T;
  }
  const out = { ...(current as Record<string, unknown>) };
  const defRec = defaults as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key in defRec) {
      out[key] = patchCorruptedStringsFromDefaults(out[key], defRec[key]);
    }
  }
  return out as T;
}

/** Réparation heuristique (script de restauration uniquement) pour champs custom sans défaut structuré. */
export function repairLikelyEncodingCorruption(value: string): string {
  if (!value.includes("?") && !value.includes("\uFFFD") && !MOJIBAKE_PATTERN.test(value)) return value;
  let out = value;
  out = out.replace(/(\p{L})\s+\?\s+(\p{L})/gu, "$1 · $2");
  const fragments: [string, string][] = [
    ["\uFFFDquipe", "équipe"],
    ["\uFFFDv\uFFFDnement", "événement"],
    ["\uFFFDv\uFFFDnements", "événements"],
    ["priv\uFFFD", "privé"],
    ["Priv\uFFFD", "Privé"],
    ["V\uFFFDhicule", "Véhicule"],
    ["v\uFFFDhicule", "véhicule"],
    ["R\uFFFDservez", "Réservez"],
    ["R\uFFFDserver", "Réserver"],
    ["r\uFFFDservation", "réservation"],
    ["Pr\uFFFDt", "Prêt"],
    ["diff\uFFFDremment", "différemment"],
    ["Bas\uFFFDs", "Basés"],
    ["d\uFFFDdi\uFFFDe", "dédiée"],
    ["Disponibilit\uFFFD", "Disponibilité"],
    ["\uFFFDtendue", "étendue"],
    ["Si\uFFFDges", "Sièges"],
    ["A\uFFFDroport", "Aéroport"],
    ["a\uFFFDroport", "aéroport"],
    ["soir\uFFFDe", "soirée"],
    ["soir\uFFFDes", "soirées"],
    ["s\uFFFDminaire", "séminaire"],
    ["d\uFFFDplacement", "déplacement"],
    ["v?hicule", "véhicule"],
    ["V?hicule", "Véhicule"],
    ["r?ponse", "réponse"],
    ["r?ponses", "réponses"],
    ["r?servation", "réservation"],
    ["r?server", "réserver"],
    ["priv?", "privé"],
    ["soir?e", "soirée"],
    ["soir?es", "soirées"],
    ["?v?nement", "événement"],
    ["?v?nements", "événements"],
    ["?v?nementiel", "événementiel"],
    ["?v?nementielle", "événementielle"],
    ["?quipe", "équipe"],
    ["Esp\uFFFDces", "Espèces"],
    ["Ch\uFFFDque", "Chèque"],
    ["max \uFFFD ", "max · "],
    [" \uFFFD ", " · "],
    ["\uFFFD ", "· "],
    ["Si?ges", "Sièges"],
    ["compl?ter", "compléter"],
    ["A?roport", "Aéroport"],
    ["a?roport", "aéroport"],
    ["m?tropole", "métropole"],
    ["d?pendent", "dépendent"],
    ["d?lai", "délai"],
    ["d?placement", "déplacement"],
    ["d?placements", "déplacements"],
    ["annul?", "annulé"],
    ["annonc?", "annoncé"],
    ["pay?", "payé"],
    ["suppl?ment", "supplément"],
    ["disponibilit?", "disponibilité"],
    ["ponctualit?", "ponctualité"],
    ["s?rieux", "sérieux"],
    ["vid?o", "vidéo"],
    ["discr?tion", "discrétion"],
    ["r?gion", "région"],
    ["?le-de-France", "Île-de-France"],
    ["D?couvrez", "Découvrez"],
    ["Pr?t", "Prêt"],
    ["personnalis?", "personnalisé"],
  ];
  for (const [bad, good] of fragments) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  out = out.replace(/(\S)\uFFFD(\S)/g, "$1 · $2");
  return out;
}

/** Remplace récursivement les chaînes corrompues par la valeur UTF-8 propre à même chemin dans `defaults`. */
export function deepPatchCorruptedFromDefaults<T>(current: T, defaults: T): T {
  if (typeof current === "string") {
    if (!stringLooksEncodingCorrupted(current)) return current;
    if (typeof defaults === "string" && !stringLooksEncodingCorrupted(defaults)) return defaults;
    return repairLikelyEncodingCorruption(current) as T;
  }
  if (
    current === null ||
    defaults === null ||
    typeof current !== "object" ||
    typeof defaults !== "object"
  ) {
    return current;
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(defaults)) return current;
    return current.map((item, i) => deepPatchCorruptedFromDefaults(item, defaults[i])) as T;
  }
  const out = { ...(current as Record<string, unknown>) };
  const defRec = defaults as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key in defRec) {
      out[key] = deepPatchCorruptedFromDefaults(out[key], defRec[key]);
    } else if (typeof out[key] === "string" && stringLooksEncodingCorrupted(out[key] as string)) {
      out[key] = repairLikelyEncodingCorruption(out[key] as string);
    }
  }
  return out as T;
}

export function deepRepairEncodingCorruption(node: unknown): unknown {
  if (typeof node === "string") return repairLikelyEncodingCorruption(node);
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(deepRepairEncodingCorruption);
  const rec = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rec)) {
    out[key] = deepRepairEncodingCorruption(val);
  }
  return out;
}

export function collectEncodingCorruptionPaths(obj: unknown, pathPrefix: string[] = []): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === "string") {
      if (stringLooksEncodingCorrupted(node)) paths.push(path.join("."));
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      walk(val, [...path, key]);
    }
  };
  walk(obj, pathPrefix);
  return paths;
}
