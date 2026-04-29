import type { TenantConfig } from "../../types/tenant";

const THEME = {
  pageBg: "#eef2f6",
  cardBg: "#ffffff",
  cardAlt: "#f8fafc",
  headerBg: "#111827",
  accent: "#f97316",
  accentDark: "#ea580c",
  text: "#172033",
  textSoft: "#475569",
  textMuted: "#64748b",
  border: "#dbe3ec",
  success: "#15803d",
  successBg: "#ecfdf3",
  danger: "#b91c1c",
  dangerBg: "#fef2f2",
  warning: "#9a3412",
  warningBg: "#fff7ed",
} as const;

type SectionId = "meta" | "client" | "trip" | "pricing" | "comment";

type CustomerDecisionOutcome = "accepted" | "refused";

type RowDef = {
  key: string;
  label: string;
  value: string;
  section: SectionId;
};

const SECTION_ORDER: SectionId[] = ["meta", "client", "trip", "pricing", "comment"];

const SECTION_TITLES: Record<SectionId, string> = {
  meta: "Demande",
  client: "Client",
  trip: "Prestation et trajet",
  pricing: "Tarif et paiement",
  comment: "Commentaire",
};

const FIELD_LABELS: Record<string, string> = {
  LeadId: "Reference interne",
  ID: "Reference dossier",
  TypeDemande: "Type de demande",
  Statut: "Statut",
  Prenom: "Prenom",
  Nom: "Nom",
  Telephone: "Telephone",
  Email: "E-mail",
  Societe: "Societe",
  NomSociete: "Societe",
  Organisation: "Organisation",
  TypeService: "Type de service",
  TypeTrajet: "Type de trajet",
  Date: "Date",
  Heure: "Heure",
  DateAller: "Date aller",
  HeureAller: "Heure aller",
  DateRetour: "Date retour",
  HeureRetour: "Heure retour",
  AdresseDepart: "Adresse de depart",
  "AdresseDépart": "Adresse de depart",
  AdresseArrivee: "Adresse d'arrivee",
  "AdresseArrivée": "Adresse d'arrivee",
  AdresseDepart_1: "Depart",
  AdresseArrivee_1: "Arrivee",
  AdresseDepart_2: "Depart retour",
  AdresseArrivee_2: "Arrivee retour",
  Aeroport: "Aeroport",
  Passagers: "Passagers",
  NombrePassagers: "Passagers",
  Bagages: "Bagages",
  BagagesAller: "Bagages aller",
  BagagesRetour: "Bagages retour",
  Commentaires: "Commentaire client",
  Observations: "Commentaire client",
  TarifTotal: "Tarif total",
  "Payé": "Paiement recu",
  Paye: "Paiement recu",
  PaymentMethode: "Mode de paiement",
  "RésuméTrajet": "Resume du trajet",
  ResumeTrajet: "Resume du trajet",
  LieuEvenement: "Lieu de l'evenement",
  HeuresMAD: "Duree M.A.D.",
  HeuresMADEvenementiel: "Duree M.A.D. evenement",
  AllerNumeroVol: "Numero de vol aller",
  AllerHeureVol: "Horaire vol aller",
  RetourNumeroVol: "Numero de vol retour",
  RetourHeureVol: "Horaire vol retour",
  Options: "Options",
  NombreInvites: "Invites",
};

const ALLOWED_FIELDS = new Set(Object.keys(FIELD_LABELS));

const KEYS_SKIP_IN_ROWS = new Set(["DashboardLink"]);

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
  pricing: ["TarifTotal", "Payé", "Paye", "PaymentMethode"],
  comment: ["Commentaires", "Observations"],
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function publicSiteUrl(tenant: TenantConfig): string {
  return tenant.branding?.siteUrl?.trim() || process.env.PUBLIC_SITE_URL?.trim() || "https://localhost";
}

function brandName(tenant: TenantConfig): string {
  return tenant.company.name.trim();
}

function telHref(phone: string): string {
  return `tel:${esc(phone.replace(/\s/g, ""))}`;
}

function money(value: string): string {
  const amount = Number(String(value).replace(",", "."));
  if (Number.isNaN(amount) || amount <= 0) return "";
  return `${amount.toLocaleString("fr-FR", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} EUR`;
}

function looksLikeIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function formatDateValue(value: string): string {
  if (!looksLikeIsoDate(value)) return value;
  const [year, month, day] = value.trim().split("-");
  return `${day}/${month}/${year}`;
}

function translateKind(value: string): string {
  const key = normalize(value);
  if (key === "contact") return "Contact";
  if (key === "devis" || key === "quote") return "Devis";
  if (key === "reservation") return "Reservation";
  if (key === "request") return "Demande";
  return "Demande";
}

function translateStatus(value: string): string {
  const key = normalize(value);
  const map: Record<string, string> = {
    new: "Nouveau",
    pending: "En attente",
    accepted: "Accepte",
    refused: "Refuse",
    processed: "Traite",
    archived: "Archive",
    completed: "Termine",
    cancelled: "Annule",
    expired: "Expire",
    scheduled: "Planifie",
    refunded: "Rembourse",
    paid: "Paye",
    unpaid: "Non paye",
    failed: "Echoue",
    sent: "Envoye",
  };
  return map[key] || "Statut inconnu";
}

function translatePaymentMethod(value: string): string {
  const key = normalize(value).replace(/\s+/g, "_");
  const map: Record<string, string> = {
    card: "Carte bancaire",
    carte: "Carte bancaire",
    stripe: "Carte bancaire",
    cash: "Especes",
    especes: "Especes",
    bank_transfer: "Virement",
    transfer: "Virement",
    virement: "Virement",
    paypal: "PayPal",
    paid: "Paye",
    unpaid: "Non paye",
    pending: "En attente",
    refunded: "Rembourse",
    failed: "Echoue",
  };
  return map[key] || value;
}

function translateBooleanish(value: string): string {
  const key = normalize(value);
  if (["oui", "yes", "true", "paid"].includes(key)) return "Oui";
  if (["non", "no", "false", "unpaid"].includes(key)) return "Non";
  return value;
}

function isMeaningfulValue(value: string | undefined): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const key = normalize(text);
  return ![
    "n/a",
    "na",
    "null",
    "undefined",
    "non renseigne",
    "0",
    "0.00",
    "false",
    "[]",
    "{}",
    '""',
    "aucun extra selectionne",
    "aucune",
  ].includes(key);
}

function mapValue(key: string, rawValue: string): string {
  const value = rawValue.trim();
  if (key === "TypeDemande") return translateKind(value);
  if (key === "Statut") return translateStatus(value);
  if (key === "PaymentMethode") return translatePaymentMethod(value);
  if (key === "Payé" || key === "Paye") return translateBooleanish(value);
  if (key === "TarifTotal") return money(value);
  if (key.startsWith("Date")) return formatDateValue(value);
  return value;
}

function sectionForKey(key: string): SectionId {
  if (["LeadId", "ID", "TypeDemande", "Statut"].includes(key)) return "meta";
  if (["Prenom", "Nom", "Telephone", "Email", "Societe", "NomSociete", "Organisation"].includes(key)) return "client";
  if (["TarifTotal", "Payé", "Paye", "PaymentMethode"].includes(key)) return "pricing";
  if (["Commentaires", "Observations"].includes(key)) return "comment";
  return "trip";
}

function buildRowDefs(flat: Record<string, string>): RowDef[] {
  const rows: RowDef[] = [];
  const usedLabels = new Set<string>();

  const companyFromNom = isMeaningfulValue(flat.NomSociete) ? flat.NomSociete.trim() : "";
  const companyFromSoc = isMeaningfulValue(flat.Societe) ? flat.Societe.trim() : "";
  const company = companyFromNom || companyFromSoc;

  for (const [key, rawValue] of Object.entries(flat)) {
    if (KEYS_SKIP_IN_ROWS.has(key)) continue;
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (key === "NomSociete" || key === "Societe") continue;
    if (!isMeaningfulValue(rawValue)) continue;
    if (key === "Organisation" && normalize(rawValue) === "particulier") continue;

    const value = mapValue(key, rawValue);
    if (!isMeaningfulValue(value)) continue;

    const label = FIELD_LABELS[key] || key;
    if (usedLabels.has(label)) continue;
    usedLabels.add(label);

    rows.push({ key, label, value, section: sectionForKey(key) });
  }

  if (company && !usedLabels.has("Societe")) {
    rows.push({
      key: "NomSociete",
      label: "Societe",
      value: company,
      section: "client",
    });
  }

  if (isMeaningfulValue(flat.LeadId) && isMeaningfulValue(flat.ID) && flat.LeadId.trim() === flat.ID.trim()) {
    return rows.filter((row) => row.key !== "ID");
  }

  return rows;
}

function sortRows(section: SectionId, rows: RowDef[]): RowDef[] {
  const order = KEY_ORDER[section];
  return [...rows].sort((a, b) => {
    const aIndex = order.indexOf(a.key);
    const bIndex = order.indexOf(b.key);
    const aRank = aIndex === -1 ? 999 : aIndex;
    const bRank = bIndex === -1 ? 999 : bIndex;
    return aRank - bRank || a.label.localeCompare(b.label);
  });
}

function valueHtml(row: RowDef): string {
  if (row.key === "Telephone") {
    return `<a href="${telHref(row.value)}" style="color:${THEME.accent};text-decoration:none;font-weight:600">${esc(row.value)}</a>`;
  }
  if (row.key === "Email") {
    return `<a href="mailto:${esc(row.value)}" style="color:${THEME.accent};text-decoration:none;font-weight:600">${esc(row.value)}</a>`;
  }
  return esc(row.value);
}

function rowTableHtml(rows: RowDef[]): string {
  if (!rows.length) return "";
  const body = rows
    .map(
      (row) => `<tr>
<td style="padding:11px 0;border-bottom:1px solid ${THEME.border};font-size:13px;color:${THEME.textMuted};vertical-align:top">${esc(row.label)}</td>
<td style="padding:11px 0;border-bottom:1px solid ${THEME.border};font-size:14px;color:${THEME.text};font-weight:600;text-align:right;vertical-align:top;word-break:break-word">${valueHtml(row)}</td>
</tr>`
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${body}</table>`;
}

function cardSectionHtml(title: string, rows: RowDef[]): string {
  if (!rows.length) return "";
  return `<tr>
<td style="padding:0 24px 18px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${THEME.cardAlt};border:1px solid ${THEME.border};border-radius:18px">
    <tr>
      <td style="padding:18px 18px 6px;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${THEME.accent}">
        ${esc(title)}
      </td>
    </tr>
    <tr>
      <td style="padding:0 18px 12px">
        ${rowTableHtml(rows)}
      </td>
    </tr>
  </table>
</td>
</tr>`;
}

function quickFactsHtml(rows: RowDef[]): string {
  if (!rows.length) return "";
  const cells = rows
    .map(
      (row) => `<td style="padding:10px 12px;border:1px solid ${THEME.border};border-radius:14px;background:${THEME.cardAlt};vertical-align:top">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${THEME.textMuted};font-weight:700;margin-bottom:6px">${esc(row.label)}</div>
        <div style="font-size:14px;line-height:1.45;color:${THEME.text};font-weight:700">${valueHtml(row)}</div>
      </td>`
    )
    .join("");

  return `<tr>
<td style="padding:0 24px 20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px">
    <tr>${cells}</tr>
  </table>
</td>
</tr>`;
}

function badgeHtml(label: string, tone: "accent" | "success" | "danger"): string {
  const styles =
    tone === "success"
      ? `background:${THEME.successBg};color:${THEME.success};border:1px solid #bbf7d0;`
      : tone === "danger"
        ? `background:${THEME.dangerBg};color:${THEME.danger};border:1px solid #fecaca;`
        : `background:${THEME.warningBg};color:${THEME.warning};border:1px solid #fed7aa;`;

  return `<span style="display:inline-block;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;${styles}">${esc(label)}</span>`;
}

function buttonHtml(label: string, href: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${THEME.accent};color:#ffffff;text-decoration:none;padding:15px 28px;border-radius:14px;font-size:15px;font-weight:700">${esc(label)}</a>`;
}

function shellHtml(opts: {
  preheader: string;
  brand: string;
  badge: string;
  title: string;
  intro: string;
  bodyBlocks: string;
  cta?: string;
  footerSite: string;
  footerText: string;
}): string {
  const ctaBlock = opts.cta
    ? `<tr><td style="padding:0 24px 22px;text-align:center">${opts.cta}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${THEME.pageBg};font-family:Segoe UI,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.pageBg};padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${THEME.cardBg};border:1px solid ${THEME.border};border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,0.10)">
          <tr>
            <td style="padding:28px 24px 24px;background:${THEME.headerBg};text-align:center">
              <div style="font-size:28px;font-weight:800;letter-spacing:0.08em;color:#ffffff">${esc(opts.brand)}</div>
              <div style="margin-top:16px">${opts.badge}</div>
              <div style="margin-top:18px;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff">${esc(opts.title)}</div>
              <div style="margin-top:12px;font-size:15px;line-height:1.7;color:#d7dee8">${opts.intro}</div>
            </td>
          </tr>
          ${ctaBlock}
          ${opts.bodyBlocks}
          <tr>
            <td style="padding:24px;background:#f8fafc;border-top:1px solid ${THEME.border};text-align:center">
              <p style="margin:0;font-size:13px;line-height:1.7;color:${THEME.textMuted}">
                ${esc(opts.footerText)}<br/>
                <a href="${esc(opts.footerSite)}" style="color:${THEME.accent};text-decoration:none;font-weight:700">${esc(opts.footerSite)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function rowsTextBySection(rows: RowDef[]): string {
  const grouped = new Map<SectionId, RowDef[]>();
  for (const section of SECTION_ORDER) grouped.set(section, []);
  for (const row of rows) grouped.get(row.section)!.push(row);

  const parts: string[] = [];
  for (const section of SECTION_ORDER) {
    const list = sortRows(section, grouped.get(section)!);
    if (!list.length) continue;
    parts.push(`[${SECTION_TITLES[section]}]`);
    for (const row of list) {
      parts.push(`${row.label}: ${row.value}`);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

function summaryLineIsUseful(line: string): boolean {
  if (!isMeaningfulValue(line)) return false;
  const normalized = normalize(line);
  if (/^tarif(\s+estime)?\s*:\s*0(\.00)?\s*(eur|euro|euros)?$/i.test(normalized)) return false;
  if (/^paiement\s*:\s*non\s*[—-]\s*n\/a$/i.test(normalized)) return false;
  return true;
}

function summaryListHtml(lines: string[]): string {
  if (!lines.length) return "";
  const content = lines
    .map(
      (line) => `<tr>
<td style="padding:11px 0;border-bottom:1px solid ${THEME.border};font-size:14px;line-height:1.55;color:${THEME.text};word-break:break-word">${esc(line)}</td>
</tr>`
    )
    .join("");

  return `<tr>
<td style="padding:0 24px 18px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.cardAlt};border:1px solid ${THEME.border};border-radius:18px;padding:0 18px">
    <tr>
      <td style="padding:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${THEME.accent}">
        Recapitulatif
      </td>
    </tr>
    <tr>
      <td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${content}</table>
      </td>
    </tr>
  </table>
</td>
</tr>`;
}

function buildOperatorBlocks(type: "contact" | "devis" | "reservation", flat: Record<string, string>): {
  quickFacts: string;
  sections: string;
} {
  const rows = buildRowDefs(flat);
  const grouped = new Map<SectionId, RowDef[]>();
  for (const section of SECTION_ORDER) grouped.set(section, []);
  for (const row of rows) grouped.get(row.section)!.push(row);

  const metaRows = sortRows("meta", grouped.get("meta")!).slice(0, 3);
  const quickFacts = quickFactsHtml(metaRows);

  const sections = [
    cardSectionHtml("Client", sortRows("client", grouped.get("client")!)),
    cardSectionHtml("Prestation et trajet", sortRows("trip", grouped.get("trip")!)),
    cardSectionHtml("Tarif et paiement", sortRows("pricing", grouped.get("pricing")!)),
    cardSectionHtml("Commentaire", sortRows("comment", grouped.get("comment")!)),
  ]
    .filter(Boolean)
    .join("");

  if (type === "contact" && !grouped.get("trip")!.length && !grouped.get("pricing")!.length) {
    return { quickFacts, sections };
  }

  return { quickFacts, sections };
}

function buildCustomerBodyBlocks(lines: string[], noteBlock: string): string {
  return `${summaryListHtml(lines)}${noteBlock}`;
}

function customerDecisionBadge(kind: "devis" | "reservation", outcome: CustomerDecisionOutcome): string {
  if (outcome === "accepted") {
    return kind === "devis" ? "Devis accepte" : "Reservation acceptee";
  }
  return kind === "devis" ? "Devis refuse" : "Reservation refusee";
}

export function buildOperatorEmail(opts: {
  tenant: TenantConfig;
  type: "contact" | "devis" | "reservation";
  subjectPrefix: string;
  flat: Record<string, string>;
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const title =
    opts.type === "contact"
      ? "Nouvelle demande de contact"
      : opts.type === "devis"
        ? "Nouvelle demande de devis"
        : "Nouvelle reservation";
  const subject = `${opts.subjectPrefix}${title} - ${brand}`;
  const dashboardLink =
    opts.flat.DashboardLink && isMeaningfulValue(opts.flat.DashboardLink) ? opts.flat.DashboardLink.trim() : "";

  const { quickFacts, sections } = buildOperatorBlocks(opts.type, opts.flat);
  const intro =
    opts.type === "contact"
      ? "Un client attend une reponse. Retrouvez les informations essentielles ci-dessous et ouvrez la fiche pour traiter la demande."
      : "Une nouvelle demande est arrivee dans votre espace professionnel. Ouvrez la fiche pour la consulter et agir rapidement.";

  const bodyBlocks = `${quickFacts}${sections}`;
  const html = shellHtml({
    preheader: `${title} - ${brand}`,
    brand,
    badge: badgeHtml(title, "accent"),
    title,
    intro,
    bodyBlocks,
    cta: dashboardLink ? buttonHtml("Voir la demande", dashboardLink) : undefined,
    footerSite: site,
    footerText: "Notification operateur - espace professionnel",
  });

  const textParts = [
    title,
    brand,
    "",
    dashboardLink ? `Voir la demande : ${dashboardLink}` : "",
    "",
    rowsTextBySection(buildRowDefs(opts.flat)),
    "",
    `Site : ${site}`,
  ];

  return {
    subject,
    html,
    text: textParts.filter(Boolean).join("\n"),
  };
}

export function buildCustomerConfirmation(opts: {
  tenant: TenantConfig;
  type: "devis" | "reservation";
  recipientName: string;
  summaryLines: string[];
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const usefulLines = opts.summaryLines.filter(summaryLineIsUseful);
  const kindLabel = opts.type === "devis" ? "demande de devis" : "demande de reservation";
  const subject =
    opts.type === "devis"
      ? `${brand} - Nous avons bien recu votre demande de devis`
      : `${brand} - Nous avons bien recu votre demande de reservation`;

  const intro = `Bonjour ${esc(opts.recipientName)},<br/>Nous avons bien recu votre ${esc(kindLabel)}. Notre equipe revient vers vous tres rapidement avec la suite a donner.`;
  const bodyBlocks = buildCustomerBodyBlocks(usefulLines, "");

  const html = shellHtml({
    preheader: subject,
    brand,
    badge: badgeHtml(opts.type === "devis" ? "Demande de devis" : "Demande de reservation", "accent"),
    title: "Nous avons bien recu votre demande",
    intro,
    bodyBlocks,
    cta: buttonHtml("Visiter notre site", site),
    footerSite: site,
    footerText: `${brand} - Accuse de reception`,
  });

  const text = [
    `Bonjour ${opts.recipientName},`,
    "",
    `Nous avons bien recu votre ${kindLabel}.`,
    "Notre equipe revient vers vous tres rapidement.",
    "",
    usefulLines.join("\n"),
    "",
    `${brand}`,
    site,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function buildCustomerDecisionEmail(opts: {
  tenant: TenantConfig;
  kind: "devis" | "reservation";
  outcome: CustomerDecisionOutcome;
  recipientName: string;
  summaryLines: string[];
  operatorNote?: string | null;
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const usefulLines = opts.summaryLines.filter(summaryLineIsUseful);
  const isAccepted = opts.outcome === "accepted";
  const subject = isAccepted
    ? opts.kind === "devis"
      ? `${brand} - Votre devis a ete accepte`
      : `${brand} - Votre reservation a ete acceptee`
    : opts.kind === "devis"
      ? `${brand} - Votre demande de devis ne peut pas etre acceptee`
      : `${brand} - Votre reservation ne peut pas etre acceptee`;

  const title = isAccepted
    ? opts.kind === "devis"
      ? "Votre devis a ete accepte"
      : "Votre reservation a ete acceptee"
    : opts.kind === "devis"
      ? "Votre demande de devis ne peut pas etre acceptee"
      : "Votre reservation ne peut pas etre acceptee";

  const intro = isAccepted
    ? `Bonjour ${esc(opts.recipientName)},<br/>Bonne nouvelle : votre demande a ete validee. Retrouvez ci-dessous le recapitulatif utile pour la suite.`
    : `Bonjour ${esc(opts.recipientName)},<br/>Nous sommes desoles, mais nous ne pouvons pas donner suite a votre demande dans les conditions actuelles.`;

  const noteBlock =
    opts.operatorNote && isMeaningfulValue(opts.operatorNote) && !isAccepted
      ? `<tr>
<td style="padding:0 24px 18px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${THEME.dangerBg};border:1px solid #fecaca;border-radius:18px">
    <tr>
      <td style="padding:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${THEME.danger};margin-bottom:8px">Message de notre equipe</div>
        <div style="font-size:14px;line-height:1.7;color:${THEME.text}">${esc(opts.operatorNote.trim())}</div>
      </td>
    </tr>
  </table>
</td>
</tr>`
      : "";

  const bodyBlocks = buildCustomerBodyBlocks(usefulLines, noteBlock);

  const html = shellHtml({
    preheader: subject,
    brand,
    badge: badgeHtml(customerDecisionBadge(opts.kind, opts.outcome), isAccepted ? "success" : "danger"),
    title,
    intro,
    bodyBlocks,
    cta: buttonHtml(isAccepted ? "Visiter notre site" : "Nous contacter", site),
    footerSite: site,
    footerText: `${brand} - Suivi de votre demande`,
  });

  const text = [
    `Bonjour ${opts.recipientName},`,
    "",
    title,
    isAccepted
      ? "Votre demande a ete validee par notre equipe."
      : "Nous ne pouvons pas donner suite a votre demande dans les conditions actuelles.",
    opts.operatorNote && isMeaningfulValue(opts.operatorNote) && !isAccepted ? `\nMessage :\n${opts.operatorNote.trim()}` : "",
    usefulLines.length ? `\nRecapitulatif :\n${usefulLines.join("\n")}` : "",
    "",
    brand,
    site,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export function buildOperatorDecisionEmail(opts: {
  tenant: TenantConfig;
  leadId: string;
  kindLabel: string;
  statusLabel: string;
  clientName: string;
  proUrl?: string;
}): { subject: string; html: string; text: string } {
  const brand = brandName(opts.tenant);
  const site = publicSiteUrl(opts.tenant);
  const refused = normalize(opts.statusLabel).includes("refus");
  const title = refused ? "Demande refusee" : "Demande acceptee";
  const html = shellHtml({
    preheader: `${title} - ${brand}`,
    brand,
    badge: badgeHtml(title, refused ? "danger" : "success"),
    title,
    intro: `La demande ${esc(opts.leadId)} a ete mise a jour dans votre espace professionnel.`,
    bodyBlocks: cardSectionHtml("Resume", [
      { key: "reference", label: "Reference", value: opts.leadId, section: "meta" },
      { key: "client", label: "Client", value: opts.clientName, section: "client" },
      { key: "type", label: "Type", value: opts.kindLabel, section: "meta" },
      { key: "statut", label: "Nouveau statut", value: opts.statusLabel, section: "meta" },
    ]),
    cta: opts.proUrl ? buttonHtml("Voir la demande", opts.proUrl) : undefined,
    footerSite: site,
    footerText: "Notification operateur - suivi de demande",
  });

  const text = [
    title,
    `Reference : ${opts.leadId}`,
    `Client : ${opts.clientName}`,
    `Type : ${opts.kindLabel}`,
    `Nouveau statut : ${opts.statusLabel}`,
    opts.proUrl ? `Voir la demande : ${opts.proUrl}` : "",
    site,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `${brand} - ${title}`,
    html,
    text,
  };
}
