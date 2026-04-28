import type { TenantConfig } from "../../types/tenant";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowsHtml(data: Record<string, string>): string {
  return Object.entries(data)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e5e5e5;font-weight:600;background:#f8f8f8">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #e5e5e5">${esc(v)}</td></tr>`
    )
    .join("");
}

function rowsText(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

const FIELD_LABELS: Record<string, string> = {
  LeadId: "ID de demande",
  TypeDemande: "Type de demande",
  Statut: "Statut",
  Prenom: "Prénom",
  Nom: "Nom",
  Telephone: "Téléphone",
  Email: "E-mail",
  Societe: "Société",
  TypeService: "Type de service",
  Date: "Date",
  Heure: "Heure",
  AdresseDepart: "Adresse de départ",
  "AdresseDépart": "Adresse de départ",
  AdresseArrivee: "Adresse d'arrivée",
  "AdresseArrivée": "Adresse d'arrivée",
  Aeroport: "Aéroport",
  Passagers: "Passagers",
  NombrePassagers: "Passagers",
  Bagages: "Bagages",
  BagagesAller: "Bagages",
  Commentaires: "Commentaire client",
  Observations: "Commentaire client",
  TarifTotal: "Tarif total",
  NomSociete: "Société",
  DateAller: "Date",
  HeureAller: "Heure",
  RésuméTrajet: "Trajet",
  ResumeTrajet: "Trajet",
  DashboardLink: "Voir la demande",
};

const ALLOWED_FIELDS = new Set([
  "LeadId",
  "TypeDemande",
  "Statut",
  "Prenom",
  "Nom",
  "Telephone",
  "Email",
  "Societe",
  "TypeService",
  "Date",
  "Heure",
  "AdresseDepart",
  "AdresseDépart",
  "AdresseArrivee",
  "AdresseArrivée",
  "Aeroport",
  "Passagers",
  "NombrePassagers",
  "Bagages",
  "BagagesAller",
  "Commentaires",
  "Observations",
  "TarifTotal",
  "NomSociete",
  "DateAller",
  "HeureAller",
  "RésuméTrajet",
  "ResumeTrajet",
  "DashboardLink",
]);

function isMeaningfulValue(value: string | undefined): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const normalized = text.toLowerCase();
  return ![
    "n/a",
    "na",
    "null",
    "undefined",
    "non renseigné",
    "0",
    "0.00",
    "false",
    "[]",
    "{}",
    "\"\"",
  ].includes(normalized);
}

function mapValue(key: string, value: string): string {
  if (key === "TypeDemande") {
    if (value === "contact") return "Contact";
    if (value === "devis") return "Devis";
    if (value === "reservation") return "Réservation";
  }
  if (key === "Statut") {
    const map: Record<string, string> = {
      new: "Nouveau",
      pending: "En attente",
      accepted: "Accepté",
      refused: "Refusé",
      processed: "Traité",
      archived: "Archivé",
      completed: "Terminé",
      cancelled: "Annulé",
      expired: "Expiré",
      scheduled: "Planifié",
      sent: "Email envoyé",
      failed: "Email échoué",
    };
    return map[value] || value;
  }
  return value;
}

function sanitizeEmailData(flat: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (!isMeaningfulValue(value)) continue;
    const label = FIELD_LABELS[key] || key;
    result[label] = mapValue(key, value);
  }
  return result;
}

function publicSiteUrl(tenant: TenantConfig): string {
  return (
    tenant.branding?.siteUrl?.trim() ||
    process.env.PUBLIC_SITE_URL?.trim() ||
    "https://localhost"
  );
}

function brandName(tenant: TenantConfig): string {
  return tenant.company.name.trim();
}

export function buildOperatorEmail(opts: {
  tenant: TenantConfig;
  type: "contact" | "devis" | "reservation";
  subjectPrefix: string;
  flat: Record<string, string>;
}): { subject: string; html: string; text: string } {
  const site = publicSiteUrl(opts.tenant);
  const brand = brandName(opts.tenant);
  const title =
    opts.type === "contact"
      ? "Nouvelle demande de contact"
      : opts.type === "devis"
        ? "Nouvelle demande de devis"
        : "Nouvelle réservation";
  const subject = `${opts.subjectPrefix}${title} — ${brand}`;
  const sanitized = sanitizeEmailData(opts.flat);
  const dashboardLink = opts.flat.DashboardLink && isMeaningfulValue(opts.flat.DashboardLink) ? opts.flat.DashboardLink : "";
  const text = `${title}\nSite: ${site}\n\n${rowsText(sanitized)}\n`;
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
  <p><strong>${esc(title)}</strong><br/>${esc(brand)} — <a href="${esc(site)}">${esc(site)}</a></p>
  ${dashboardLink ? `<p style="margin:12px 0 16px"><a href="${esc(dashboardLink)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600">Voir la demande</a></p>` : ""}
  <table style="border-collapse:collapse;width:100%;max-width:720px">${rowsHtml(sanitized)}</table>
  </body></html>`;
  return { subject, html, text };
}

export function buildCustomerConfirmation(opts: {
  tenant: TenantConfig;
  type: "devis" | "reservation";
  recipientName: string;
  summaryLines: string[];
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const subject =
    opts.type === "devis"
      ? `${brand} — Accusé de réception de votre demande de devis`
      : `${brand} — Accusé de réception de votre réservation`;
  const bodyText = `Bonjour ${opts.recipientName},\n\nNous avons bien reçu votre ${opts.type === "devis" ? "demande de devis" : "demande de réservation"}.\nElle va être étudiée rapidement.\n\n${opts.summaryLines.filter((line) => isMeaningfulValue(line)).join("\n")}\n\n— ${brand}\n${site}`;
  const linesHtml = opts.summaryLines.filter((line) => isMeaningfulValue(line)).map((l) => `<li>${esc(l)}</li>`).join("");
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
  <p>Bonjour ${esc(opts.recipientName)},</p>
  <p>Nous avons bien reçu votre <strong>${opts.type === "devis" ? "demande de devis" : "demande de réservation"}</strong>.</p>
  <p>Elle va être étudiée rapidement.</p>
  <ul>${linesHtml}</ul>
  <p>— ${esc(brand)}<br/><a href="${esc(site)}">${esc(site)}</a></p>
  </body></html>`;
  return { subject, html, text: bodyText };
}
