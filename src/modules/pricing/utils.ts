import type { TenantPricingEngineConfig } from "./engineTypes";

const AR_MAD_CANON = "A/R + Mise à disposition";
const AR_MAD_ALIASES = [
  AR_MAD_CANON,
  "Aller/Retour + Mise à disposition",
  "Aller-Retour + Mise à disposition",
  "Aller/Retour+Mise à disposition",
];

export function getFormattedAddress(addr: string | { formatted?: string } | null | undefined): string {
  if (!addr) return "N/A";
  if (typeof addr === "string") return addr;
  if (typeof addr === "object" && addr.formatted) return addr.formatted;
  return String(addr);
}

export function extractVille(address: string | null | undefined): string {
  const a = getFormattedAddress(address);
  if (!a || a === "N/A" || a === "Non concerné") return "N/A";
  const parts = a.split(",");
  return parts.length >= 2 ? parts[parts.length - 2].trim() : a;
}

export function normalizeTypeService(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const str = String(s).trim().toLowerCase();
  if (["mad evenementiel", "mad évènementiel", "mad événementiel"].includes(str))
    return "MAD Evenementiel";
  if (["trajet classique"].includes(str)) return "Trajet Classique";
  if (["transfert aéroport", "transfert aeroport"].includes(str))
    return "Transfert Aéroport";
  return s;
}

export function normalizeTCtrajet(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const low = String(s).toLowerCase();
  if (AR_MAD_ALIASES.map((x) => x.toLowerCase()).includes(low))
    return AR_MAD_CANON;
  if (low === "aller simple" || low === "aller") return "Aller Simple";
  if (low.includes("aller") && low.includes("retour")) return "Aller/Retour";
  return s;
}

export function airportAddressFrom(
  s: string | null | undefined,
  engine: TenantPricingEngineConfig
): string {
  if (!s) return s ?? "";
  const low = String(s).toLowerCase();
  for (const ap of Object.values(engine.airports)) {
    if (ap.names.some((n) => low.includes(n))) return ap.address;
  }
  return s;
}

export function airportCodeFromAddress(
  s: string | null | undefined,
  engine: TenantPricingEngineConfig
): string | null {
  if (!s) return null;
  const low = String(s).toLowerCase();
  for (const [code, ap] of Object.entries(engine.airports)) {
    if (ap.names.some((n) => low.includes(n))) return code;
  }
  return null;
}
