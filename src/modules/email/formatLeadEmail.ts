import type { TenantConfig } from "../../types/tenant";

const THEME = {
  pageBg: "#1e1e1e",
  cardBg: "#2a2a2a",
  headerBg: "#212121",
  accent: "#ff8c42",
  text: "#f3f4f6",
  muted: "#9ca3af",
  rowBg: "rgba(58,58,58,0.75)",
  customerPageBg: "#f3f4f6",
  customerCard: "#ffffff",
  customerText: "#1f2937",
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function telHref(phone: string): string {
  return `tel:${esc(phone.replace(/\s/g, ""))}`;
}

const FIELD_LABELS: Record<string, string> = {
  LeadId: "ID de demande",
  ID: "Référence dossier",
  TypeDemande: "Type de demande",
  Statut: "Statut",
  Prenom: "Prénom",
  Nom: "Nom",
  Telephone: "Téléphone",
  Email: "E-mail",
  Societe: "Société",
  NomSociete: "Société",
  TypeService: "Type de service",
  TypeTrajet: "Type de trajet",
  Date: "Date",
  Heure: "Heure",
  DateAller: "Date (aller)",
  HeureAller: "Heure (aller)",
  DateRetour: "Date (retour)",
  HeureRetour: "Heure (retour)",
  AdresseDepart: "Adresse de départ",
  AdresseDépart: "Adresse de départ",
  AdresseArrivee: "Adresse d'arrivée",
  AdresseArrivée: "Adresse d'arrivée",
  AdresseDepart_1: "Départ",
  AdresseArrivee_1: "Arrivée",
  AdresseDepart_2: "Départ (retour)",
  AdresseArrivee_2: "Arrivée (retour)",
  Aeroport: "Aéroport",
  Passagers: "Passagers",
  NombrePassagers: "Passagers",
  Bagages: "Bagages",
  BagagesAller: "Bagages (aller)",
  BagagesRetour: "Bagages (retour)",
  Commentaires: "Commentaire client",
  Observations: "Commentaire client",
  TarifTotal: "Tarif total",
  Payé: "Payé",
  PaymentMethode: "Mode de paiement",
  RésuméTrajet: "Synthèse du trajet",
  ResumeTrajet: "Synthèse du trajet",
  LieuEvenement: "Lieu (événement)",
  HeuresMAD: "Durée M.A.D. (h)",
  HeuresMADEvenementiel: "Durée M.A.D. événement (h)",
  AllerNumeroVol: "N° vol (aller)",
  AllerHeureVol: "Horaire vol (aller)",
  RetourNumeroVol: "N° vol (retour)",
  RetourHeureVol: "Horaire vol (retour)",
  Options: "Options",
  NombreInvites: "Invités",
  Organisation: "Organisation",
};

const ALLOWED_FIELDS = new Set(Object.keys(FIELD_LABELS));

const KEYS_SKIP_IN_ROWS = new Set(["DashboardLink"]);

type SectionId = "meta" | "client" | "trip" | "pricing" | "comment";

const SECTION_ORDER: SectionId[] = ["meta", "client", "trip", "pricing", "comment"];

const SECTION_TITLES: Record<SectionId, string> = {
  meta: "Demande",
  client: "Client",
  trip: "Prestation & trajet",
  pricing: "Tarif & paiement",
  comment: "Commentaire",
};

function sectionForKey(key: string): SectionId {
  if (["LeadId", "ID", "TypeDemande", "Statut"].includes(key)) return "meta";
  if (
    ["Prenom", "Nom", "Telephone", "Email", "Societe", "NomSociete", "Organisation"].includes(key)
  )
    return "client";
  if (
    [
      "TypeService",
      "TypeTrajet",
      "RésuméTrajet",
      "ResumeTrajet",
      "Date",
      "Heure",
      "DateAller",
      "HeureAller",
      "DateRetour",
      "HeureRetour",
      "AdresseDepart",
      "AdresseDépart",
      "AdresseArrivee",
      "AdresseArrivée",
      "AdresseDepart_1",
      "AdresseArrivee_1",
      "AdresseDepart_2",
      "AdresseArrivee_2",
      "Aeroport",
      "Passagers",
      "NombrePassagers",
      "Bagages",
      "BagagesAller",
      "BagagesRetour",
      "LieuEvenement",
      "HeuresMAD",
      "HeuresMADEvenementiel",
      "AllerNumeroVol",
      "AllerHeureVol",
      "RetourNumeroVol",
      "RetourHeureVol",
      "Options",
      "NombreInvites",
    ].includes(key)
  )
    return "trip";
  if (["TarifTotal", "Payé", "PaymentMethode"].includes(key)) return "pricing";
  if (["Commentaires", "Observations"].includes(key)) return "comment";
  return "trip";
}

/** Ordre d’affichage des clés dans chaque section (les autres clés autorisées suivent à la fin). */
const KEY_ORDER: Record<SectionId, string[]> = {
  meta: ["LeadId", "ID", "TypeDemande", "Statut"],
  client: ["Organisation", "NomSociete", "Societe", "Prenom", "Nom", "Telephone", "Email"],
  trip: [
    "TypeService",
    "TypeTrajet",
    "RésuméTrajet",
    "ResumeTrajet",
    "DateAller",
    "HeureAller",
    "DateRetour",
    "HeureRetour",
    "Date",
    "Heure",
    "AdresseDepart_1",
    "AdresseArrivee_1",
    "AdresseDepart_2",
    "AdresseArrivee_2",
    "AdresseDepart",
    "AdresseDépart",
    "AdresseArrivee",
    "AdresseArrivée",
    "Aeroport",
    "LieuEvenement",
    "HeuresMAD",
    "HeuresMADEvenementiel",
    "AllerNumeroVol",
    "AllerHeureVol",
    "RetourNumeroVol",
    "RetourHeureVol",
    "NombrePassagers",
    "Passagers",
    "BagagesAller",
    "BagagesRetour",
    "Bagages",
    "NombreInvites",
    "Options",
  ],
  pricing: ["TarifTotal", "Payé", "PaymentMethode"],
  comment: ["Commentaires", "Observations"],
};

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
    '""',
    "aucun extra sélectionné",
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
      sent: "E-mail envoyé",
      failed: "E-mail échoué",
    };
    return map[value] || value;
  }
  if (key === "TarifTotal" && isMeaningfulValue(value)) {
    const n = Number(String(value).replace(",", "."));
    if (!Number.isNaN(n)) return `${n.toFixed(2)} €`;
  }
  return value;
}

interface RowDef {
  key: string;
  label: string;
  value: string;
  section: SectionId;
}

function buildRowDefs(flat: Record<string, string>): RowDef[] {
  const usedLabels = new Set<string>();
  const rows: RowDef[] = [];

  const companyFromNom = isMeaningfulValue(flat.NomSociete) ? flat.NomSociete : undefined;
  const companyFromSoc = isMeaningfulValue(flat.Societe) ? flat.Societe : undefined;
  const company = companyFromNom ?? companyFromSoc;

  for (const [key, raw] of Object.entries(flat)) {
    if (KEYS_SKIP_IN_ROWS.has(key)) continue;
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (key === "NomSociete" || key === "Societe") continue;
    if (!isMeaningfulValue(raw)) continue;
    if (key === "Organisation" && String(raw).trim().toLowerCase() === "particulier") continue;

    let value = mapValue(key, raw);
    const label = FIELD_LABELS[key] || key;

    if (usedLabels.has(label)) continue;
    usedLabels.add(label);

    rows.push({ key, label, value, section: sectionForKey(key) });
  }

  if (company) {
    const label = "Société";
    if (!usedLabels.has(label)) {
      rows.push({
        key: "NomSociete",
        label,
        value: mapValue("NomSociete", company),
        section: "client",
      });
      usedLabels.add(label);
    }
  }

  if (
    isMeaningfulValue(flat.LeadId) &&
    isMeaningfulValue(flat.ID) &&
    flat.LeadId.trim() === flat.ID.trim()
  ) {
    return rows.filter((r) => r.key !== "ID");
  }

  return rows;
}

function sortRowsInSection(rows: RowDef[], section: SectionId): RowDef[] {
  const order = KEY_ORDER[section];
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? 999 : i;
  };
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

function valueCellHtml(row: RowDef): string {
  const v = esc(row.value);
  if (row.key === "Telephone") {
    return `<a href="${telHref(row.value)}" style="color:${THEME.accent};text-decoration:none">${v}</a>`;
  }
  if (row.key === "Email") {
    return `<a href="mailto:${esc(row.value)}" style="color:${THEME.accent};text-decoration:none">${v}</a>`;
  }
  return v;
}

function sectionTableHtml(rows: RowDef[]): string {
  if (!rows.length) return "";
  const body = rows
    .map(
      (r) => `<tr>
<td style="padding:12px 14px;font-size:14px;font-weight:600;color:${THEME.accent};background:${THEME.rowBg};border-radius:8px 0 0 8px;width:42%;vertical-align:top">${esc(r.label)}</td>
<td style="padding:12px 14px;font-size:14px;color:${THEME.text};text-align:right;background:${THEME.rowBg};border-radius:0 8px 8px 0;vertical-align:top;word-break:break-word">${valueCellHtml(r)}</td>
</tr>
<tr><td colspan="2" style="height:8px;padding:0;border:0"></td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">${body}</table>`;
}

function sectionBlockHtml(title: string, rows: RowDef[]): string {
  if (!rows.length) return "";
  return `<tr>
<td style="padding:8px 20px 20px">
<div style="font-size:16px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;padding-left:12px;border-left:4px solid ${THEME.accent}">${esc(title)}</div>
${sectionTableHtml(rows)}
</td>
</tr>`;
}

function commentBlockHtml(text: string): string {
  return `<tr>
<td style="padding:8px 20px 20px">
<div style="font-size:16px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;padding-left:12px;border-left:4px solid ${THEME.accent}">${esc(SECTION_TITLES.comment)}</div>
<div style="background:${THEME.rowBg};padding:16px;border-radius:8px;font-size:14px;color:${THEME.text};line-height:1.55;white-space:pre-wrap">${esc(text)}</div>
</td>
</tr>`;
}

function rowsTextBySection(rowDefs: RowDef[]): string {
  const bySection = new Map<SectionId, RowDef[]>();
  for (const s of SECTION_ORDER) bySection.set(s, []);
  for (const r of rowDefs) {
    bySection.get(r.section)!.push(r);
  }
  const lines: string[] = [];
  for (const s of SECTION_ORDER) {
    const list = sortRowsInSection(bySection.get(s)!, s);
    if (!list.length) continue;
    lines.push(`[${SECTION_TITLES[s]}]`);
    for (const r of list) lines.push(`${r.label}: ${r.value}`);
    lines.push("");
  }
  return lines.join("\n").trim();
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

  const rowDefs = buildRowDefs(opts.flat);
  const bySection = new Map<SectionId, RowDef[]>();
  for (const s of SECTION_ORDER) bySection.set(s, []);
  for (const r of rowDefs) bySection.get(r.section)!.push(r);

  const commentRows = bySection.get("comment")!;
  const commentText = commentRows.map((r) => r.value).join("\n\n");

  const dashboardLink =
    opts.flat.DashboardLink && isMeaningfulValue(opts.flat.DashboardLink)
      ? opts.flat.DashboardLink.trim()
      : "";

  let sectionsHtml = "";
  for (const s of SECTION_ORDER) {
    if (s === "comment") {
      if (commentText) sectionsHtml += commentBlockHtml(commentText);
      continue;
    }
    const sorted = sortRowsInSection(bySection.get(s)!, s);
    sectionsHtml += sectionBlockHtml(SECTION_TITLES[s], sorted);
  }

  const ctaBlock = dashboardLink
    ? `<tr>
<td style="padding:4px 20px 8px;text-align:center">
<a href="${esc(dashboardLink)}" style="display:inline-block;background:${THEME.accent};color:#1a1a1a;text-decoration:none;padding:14px 28px;border-radius:28px;font-weight:700;font-size:15px">Voir la demande</a>
</td>
</tr>
<tr>
<td style="padding:8px 24px 20px;text-align:center;font-size:13px;color:${THEME.muted};line-height:1.5">
Connectez-vous à l’espace professionnel pour accepter, refuser ou traiter cette demande.
</td>
</tr>`
    : "";

  const preheader = `${title} — ${brand}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${THEME.pageBg};font-family:'Segoe UI',Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${THEME.pageBg};padding:20px 8px">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${THEME.cardBg};border:1px solid ${THEME.accent};border-radius:10px;overflow:hidden">
<tr>
<td style="background:${THEME.headerBg};padding:22px 20px;text-align:center;border-bottom:3px solid ${THEME.accent}">
<p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px">${esc(brand)}</p>
<p style="margin:10px 0 0;font-size:12px;color:#cccccc;text-transform:uppercase;letter-spacing:1px">Notification opérateur</p>
</td>
</tr>
<tr>
<td style="background:${THEME.accent};padding:14px 16px;text-align:center;font-weight:700;font-size:15px;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.5px">
${esc(title)}
</td>
</tr>
<tr>
<td style="padding:18px 20px 8px;font-size:14px;color:${THEME.text};line-height:1.55">
Une nouvelle demande nécessite votre attention. Retrouvez le détail ci-dessous ou ouvrez directement la fiche dans votre espace pro.
</td>
</tr>
${ctaBlock}
${sectionsHtml}
<tr>
<td style="background:${THEME.headerBg};padding:18px 20px;text-align:center;border-top:2px solid ${THEME.accent}">
<p style="margin:0;font-size:13px;color:${THEME.muted}"><a href="${esc(site)}" style="color:${THEME.accent};text-decoration:none">${esc(site)}</a></p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [
    `${title}`,
    `${brand}`,
    `Site : ${site}`,
    "",
    dashboardLink ? `Voir la demande : ${dashboardLink}` : "",
    "",
    rowsTextBySection(rowDefs),
    "",
    "Connectez-vous à l’espace professionnel pour accepter, refuser ou traiter cette demande.",
  ];
  const text = textParts.filter(Boolean).join("\n");

  return { subject, html, text };
}

function summaryLineIsUseful(line: string): boolean {
  if (!isMeaningfulValue(line)) return false;
  const t = line.trim();
  if (/^tarif(\s+estimé)?\s*:\s*0(\.00)?\s*€$/i.test(t)) return false;
  if (/^tarif\s*:\s*0(\.00)?\s*€$/i.test(t)) return false;
  if (/^paiement\s*:\s*non\s*[—\-]\s*n\/a\s*$/i.test(t)) return false;
  return true;
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

  const usefulLines = opts.summaryLines.filter(summaryLineIsUseful);
  const kindLabel = opts.type === "devis" ? "demande de devis" : "demande de réservation";

  const linesHtml = usefulLines
    .map((l) => `<li style="margin:6px 0;color:${THEME.customerText}">${esc(l)}</li>`)
    .join("");

  const bodyText = `Bonjour ${opts.recipientName},\n\nNous avons bien reçu votre ${kindLabel}.\nElle va être étudiée rapidement.\n\n${usefulLines.join("\n")}\n\n— ${brand}\n${site}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${THEME.customerPageBg};font-family:'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.customerPageBg};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:${THEME.customerCard};border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 10px 28px rgba(0,0,0,0.06)">
<tr>
<td style="background:#1e1e1e;color:#fff;padding:20px;text-align:center;border-bottom:4px solid ${THEME.accent}">
<span style="font-size:22px;font-weight:800;letter-spacing:0.5px">${esc(brand)}</span>
</td>
</tr>
<tr>
<td style="padding:26px 22px">
<p style="margin:0 0 14px;font-size:16px;color:${THEME.customerText}">Bonjour ${esc(opts.recipientName)},</p>
<p style="margin:0 0 12px;font-size:15px;color:#4b5563;line-height:1.65">Nous avons bien reçu votre <strong style="color:${THEME.customerText}">${esc(kindLabel)}</strong>.</p>
<p style="margin:0 0 18px;font-size:15px;color:#4b5563;line-height:1.65">Elle va être étudiée rapidement par notre équipe.</p>
${usefulLines.length ? `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${THEME.accent};text-transform:uppercase;letter-spacing:0.5px">Récapitulatif</p><ul style="margin:0;padding-left:20px">${linesHtml}</ul>` : ""}
<p style="margin:22px 0 0;font-size:14px;color:#6b7280">— ${esc(brand)}<br/><a href="${esc(site)}" style="color:${THEME.accent};text-decoration:none;font-weight:600">${esc(site)}</a></p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text: bodyText };
}
