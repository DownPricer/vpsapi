import type { TenantConfig } from "../../types/tenant";
import { emailKit, type EmailRow } from "./formatLeadEmail";

/**
 * Modèles e-mail annulation / remboursement. Aucune donnée bancaire sensible : jamais de numéro de carte,
 * d'IBAN ni d'identifiant Stripe interne — uniquement montants, statuts et références de réservation.
 */

const { shellHtml, badgeHtml, amountHeroHtml, cardSectionHtml, commentCardHtml, buttonHtml, brandName, publicSiteUrl, contactRowsOf, tripBlockFromSummary, esc } =
  emailKit;

export type MailCommon = {
  tenant: TenantConfig;
  clientName?: string;
  reference: string;
  tripSummary?: string | null;
  rideDateLabel?: string | null;
  vtcPhone?: string | null;
  vtcEmail?: string | null;
};

type Tone = "accent" | "success" | "danger";
type Pkg = { subject: string; html: string; text: string };

type Spec = {
  common: MailCommon;
  subject: string;
  badge: string;
  tone: Tone;
  title: string;
  intro: string;
  amountLabel?: string;
  amountValue?: string;
  details: Array<{ label: string; value: string }>;
  notes?: Array<{ title: string; text: string }>;
  buttons?: Array<{ label: string; href: string; variant?: "primary" | "secondary" }>;
  closing?: string;
  audience: "customer" | "operator";
};

function shortRef(ref: string): string {
  return ref.length > 14 ? `${ref.slice(0, 8)}…` : ref;
}

function compose(spec: Spec): Pkg {
  const { common } = spec;
  const brand = brandName(common.tenant);
  const site = publicSiteUrl(common.tenant);

  const rows: EmailRow[] = [
    { key: "ref", label: "Référence réservation", value: common.reference, section: "meta" },
    ...(common.rideDateLabel ? [{ key: "date", label: "Date de la course", value: common.rideDateLabel, section: "trip" as const }] : []),
    ...spec.details.map((d, i) => ({ key: `d${i}`, label: d.label, value: d.value, section: "pricing" as const })),
  ];

  const detailBlock = cardSectionHtml("Récapitulatif", rows);
  const tripBlock = tripBlockFromSummary(common.tripSummary);
  const notesBlock = (spec.notes ?? []).map((n) => commentCardHtml(n.title, n.text)).join("");
  const contactBlock =
    spec.audience === "customer" ? cardSectionHtml("Contact", contactRowsOf(common.vtcPhone, common.vtcEmail)) : "";
  const amountBlock = spec.amountValue ? amountHeroHtml(spec.amountLabel ?? "Montant", spec.amountValue) : "";

  const html = shellHtml({
    preheader: `${spec.subject} - ${brand}`,
    brand,
    badge: badgeHtml(spec.badge, spec.tone),
    reference: shortRef(common.reference),
    title: spec.title,
    intro: spec.intro,
    bodyBlocks: `${amountBlock}${detailBlock}${tripBlock}${notesBlock}${contactBlock}`,
    actionsBottom: (spec.buttons ?? []).map((b) => buttonHtml(b.label, b.href, b.variant ?? "primary")),
    footerSite: site,
    footerText: spec.audience === "customer" ? `${brand} - Votre réservation` : `${brand} - Notification chauffeur`,
  });

  const textLines: string[] = [spec.subject, brand, "", stripTags(spec.intro), ""];
  if (spec.amountValue) textLines.push(`${spec.amountLabel ?? "Montant"} : ${spec.amountValue}`);
  for (const r of rows) textLines.push(`${r.label} : ${r.value}`);
  if (common.tripSummary?.trim()) textLines.push("", `Trajet : ${common.tripSummary.trim()}`);
  for (const n of spec.notes ?? []) textLines.push("", `${n.title} : ${n.text}`);
  for (const b of spec.buttons ?? []) textLines.push("", `${b.label} : ${b.href}`);
  if (spec.audience === "customer") {
    if (common.vtcPhone?.trim()) textLines.push("", `Téléphone : ${common.vtcPhone.trim()}`);
    if (common.vtcEmail?.trim()) textLines.push(`E-mail : ${common.vtcEmail.trim()}`);
  }
  if (spec.closing) textLines.push("", spec.closing);
  textLines.push("", brand, site);

  return { subject: spec.subject, html, text: textLines.join("\n") };
}

function stripTags(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

function hello(name?: string): string {
  const n = name?.trim();
  return n ? `Bonjour ${esc(n)},<br/><br/>` : "Bonjour,<br/><br/>";
}

export type PolicyNote = { title: string; text: string };

/** 1. Demande d'annulation reçue — accusé de réception au client. */
export function buildCancellationRequestReceivedCustomer(
  opts: MailCommon & { reason: string; amountPaidFormatted?: string | null; policy: PolicyNote[]; manageUrl?: string | null }
): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: "Demande d'annulation reçue",
    badge: "Demande reçue",
    tone: "accent",
    title: "Nous avons bien reçu votre demande",
    intro: `${hello(opts.clientName)}Votre demande d'annulation a été transmise à ${esc(brandName(opts.tenant))}. Elle sera examinée par le chauffeur, qui reviendra vers vous. <strong>Votre réservation reste valable tant qu'elle n'est pas confirmée comme annulée.</strong>`,
    details: [
      { label: "Statut", value: "Annulation demandée — en attente de réponse" },
      ...(opts.amountPaidFormatted ? [{ label: "Montant payé", value: opts.amountPaidFormatted }] : []),
      { label: "Motif indiqué", value: opts.reason },
    ],
    notes: [
      ...(opts.policy.length
        ? opts.policy
        : [{ title: "Conditions d'annulation", text: "Aucune condition enregistrée pour cette réservation : le chauffeur traitera votre demande au cas par cas." }]),
      { title: "Remboursement", text: "Aucun remboursement n'est déclenché automatiquement. Si un remboursement est accordé, vous en serez informé par e-mail." },
    ],
    buttons: opts.manageUrl ? [{ label: "Suivre ma réservation", href: opts.manageUrl, variant: "secondary" }] : [],
  });
}

/** 1 bis. Demande d'annulation reçue — notification chauffeur. */
export function buildCancellationRequestReceivedOperator(
  opts: MailCommon & { reason: string; amountPaidFormatted?: string | null; proUrl?: string | null }
): Pkg {
  return compose({
    common: opts,
    audience: "operator",
    subject: "Demande d'annulation reçue — action requise",
    badge: "Action requise",
    tone: "danger",
    title: "Un client demande l'annulation",
    intro: `Un client souhaite annuler sa réservation. Vous pouvez accepter, refuser ou proposer un remboursement (intégral ou partiel) depuis votre espace pro. <strong>Aucun remboursement n'est déclenché automatiquement.</strong>`,
    details: [
      ...(opts.clientName ? [{ label: "Client", value: opts.clientName }] : []),
      { label: "Statut", value: "Annulation demandée" },
      ...(opts.amountPaidFormatted ? [{ label: "Montant payé", value: opts.amountPaidFormatted }] : []),
    ],
    notes: [{ title: "Motif du client", text: opts.reason }],
    buttons: opts.proUrl ? [{ label: "Traiter la demande", href: opts.proUrl }] : [],
  });
}

/** 2. Annulation acceptée (suite à une demande du client). */
export function buildCancellationAcceptedCustomer(
  opts: MailCommon & { refundNote?: string | null; operatorNote?: string | null }
): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: "Annulation acceptée",
    badge: "Annulée",
    tone: "success",
    title: "Votre annulation est confirmée",
    intro: `${hello(opts.clientName)}Le chauffeur a accepté votre demande : la réservation ci-dessous est annulée.`,
    details: [{ label: "Statut", value: "Réservation annulée" }],
    notes: [
      ...(opts.refundNote ? [{ title: "Remboursement", text: opts.refundNote }] : []),
      ...(opts.operatorNote?.trim() ? [{ title: "Message du chauffeur", text: opts.operatorNote.trim() }] : []),
    ],
  });
}

/** Demande d'annulation refusée (traitée manuellement ou non accordée). */
export function buildCancellationRefusedCustomer(opts: MailCommon & { operatorNote?: string | null; manual?: boolean }): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: opts.manual ? "Votre demande d'annulation est en cours de traitement" : "Demande d'annulation non accordée",
    badge: opts.manual ? "En traitement" : "Non accordée",
    tone: opts.manual ? "accent" : "danger",
    title: opts.manual ? "Le chauffeur vous contactera" : "Votre réservation est maintenue",
    intro: opts.manual
      ? `${hello(opts.clientName)}Le chauffeur traite votre demande d'annulation directement avec vous. Il vous contactera prochainement.`
      : `${hello(opts.clientName)}Le chauffeur n'a pas pu accorder l'annulation demandée : votre réservation est maintenue.`,
    details: [{ label: "Statut", value: opts.manual ? "Traitement manuel" : "Réservation maintenue" }],
    notes: opts.operatorNote?.trim() ? [{ title: "Message du chauffeur", text: opts.operatorNote.trim() }] : [],
  });
}

/** 3. Réservation annulée par le chauffeur. */
export function buildCancelledByDriverCustomer(
  opts: MailCommon & { reason?: string | null; refundNote?: string | null; amountPaidFormatted?: string | null }
): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: "Votre réservation a été annulée",
    badge: "Annulée",
    tone: "danger",
    title: "Votre réservation est annulée",
    intro: `${hello(opts.clientName)}Nous sommes désolés : ${esc(brandName(opts.tenant))} ne peut pas assurer la course ci-dessous et a dû l'annuler.`,
    details: [
      { label: "Statut", value: "Réservation annulée par le chauffeur" },
      ...(opts.amountPaidFormatted ? [{ label: "Montant payé", value: opts.amountPaidFormatted }] : []),
    ],
    notes: [
      ...(opts.reason?.trim() ? [{ title: "Motif", text: opts.reason.trim() }] : []),
      ...(opts.refundNote ? [{ title: "Remboursement", text: opts.refundNote }] : []),
    ],
  });
}

/** 4. Remboursement initié. */
export function buildRefundInitiatedCustomer(opts: MailCommon & { amountFormatted: string; partial: boolean }): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: "Remboursement en cours",
    badge: "En cours",
    tone: "accent",
    title: "Votre remboursement est en cours",
    intro: `${hello(opts.clientName)}Un remboursement ${opts.partial ? "partiel " : ""}a été initié. Il sera visible sur votre moyen de paiement sous quelques jours ouvrés, selon votre banque.`,
    amountLabel: "Montant remboursé",
    amountValue: opts.amountFormatted,
    details: [{ label: "Statut", value: "Remboursement en cours" }],
  });
}

/** 5 & 6. Remboursement confirmé (intégral) ou partiel. */
export function buildRefundConfirmedCustomer(
  opts: MailCommon & { amountFormatted: string; partial: boolean; totalRefundedFormatted?: string | null; receiptUrl?: string | null }
): Pkg {
  return compose({
    common: opts,
    audience: "customer",
    subject: opts.partial ? "Remboursement partiel confirmé" : "Remboursement confirmé",
    badge: opts.partial ? "Remboursement partiel" : "Remboursé",
    tone: "success",
    title: opts.partial ? "Votre remboursement partiel est confirmé" : "Votre remboursement est confirmé",
    intro: `${hello(opts.clientName)}Stripe a confirmé le remboursement. Selon votre banque, il apparaît sur votre relevé sous 5 à 10 jours ouvrés.`,
    amountLabel: "Montant remboursé",
    amountValue: opts.amountFormatted,
    details: [
      { label: "Statut", value: opts.partial ? "Partiellement remboursé" : "Totalement remboursé" },
      ...(opts.partial && opts.totalRefundedFormatted ? [{ label: "Total remboursé à ce jour", value: opts.totalRefundedFormatted }] : []),
    ],
    buttons: opts.receiptUrl?.startsWith("https://") ? [{ label: "Voir le reçu Stripe", href: opts.receiptUrl, variant: "secondary" }] : [],
  });
}

/** 7. Échec de remboursement (client : message neutre ; chauffeur : action requise). */
export function buildRefundFailedEmail(
  opts: MailCommon & { amountFormatted: string; audience: "customer" | "operator"; proUrl?: string | null; reasonLabel?: string | null }
): Pkg {
  if (opts.audience === "operator") {
    return compose({
      common: opts,
      audience: "operator",
      subject: "Échec d'un remboursement — action requise",
      badge: "Échec",
      tone: "danger",
      title: "Un remboursement a échoué",
      intro: "Stripe n'a pas pu finaliser un remboursement. Aucune somme n'a été restituée au client. Vérifiez votre compte Stripe puis réessayez depuis votre espace pro.",
      amountLabel: "Montant concerné",
      amountValue: opts.amountFormatted,
      details: [
        { label: "Statut", value: "Remboursement échoué" },
        ...(opts.reasonLabel ? [{ label: "Cause Stripe", value: opts.reasonLabel }] : []),
      ],
      buttons: opts.proUrl ? [{ label: "Ouvrir la réservation", href: opts.proUrl }] : [],
    });
  }
  return compose({
    common: opts,
    audience: "customer",
    subject: "Votre remboursement n'a pas pu être finalisé",
    badge: "À vérifier",
    tone: "danger",
    title: "Remboursement en attente de vérification",
    intro: `${hello(opts.clientName)}Le remboursement n'a pas pu être finalisé automatiquement. Le chauffeur a été prévenu et vous recontactera pour régulariser la situation.`,
    amountLabel: "Montant concerné",
    amountValue: opts.amountFormatted,
    details: [{ label: "Statut", value: "Remboursement à reprendre" }],
  });
}
