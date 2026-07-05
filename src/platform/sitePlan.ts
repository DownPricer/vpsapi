import { DateTime } from "luxon";
import type { TenantAuditResult } from "./auditTenantContent";

export type GlobalSiteStatusFine =
  | "ok"
  | "a_configurer"
  | "incomplet"
  | "risque"
  | "erreur";

export type SitePriority = "critique" | "important" | "moyen" | "faible";

export type PlanAction = {
  id: string;
  action: string;
  pourquoi: string;
  gravite: "critique" | "warning" | "info";
  statut: "a_faire" | "ok";
};

export type SitePlanInput = {
  tenantId: string;
  active: boolean;
  settingsPresent: boolean;
  stripeConnected: boolean;
  stripeOk: boolean;
  audit: TenantAuditResult;
  lastActivityAt: Date | null;
  // évènements “récents” sur la période (range)
  eventCounts: Record<string, number>;
  emailFailedCount: number;
  paymentFailedCount: number;
  paymentPaidCount: number;
  calculatorFailedCount: number;
  errorsCount: number; // api_error + admin_error
  pricingSuspect: boolean;
};

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  const now = DateTime.utc();
  const dt = DateTime.fromJSDate(d, { zone: "utc" });
  return Math.floor(now.diff(dt, "days").days);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function priorityFromScore(score: number): SitePriority {
  if (score >= 70) return "critique";
  if (score >= 45) return "important";
  if (score >= 25) return "moyen";
  return "faible";
}

export function fineStatusLabel(s: GlobalSiteStatusFine): string {
  if (s === "ok") return "OK";
  if (s === "a_configurer") return "À configurer";
  if (s === "incomplet") return "Incomplet";
  if (s === "risque") return "Risque";
  return "Erreur";
}

export function legacyStatusFromFine(s: GlobalSiteStatusFine, active: boolean): "ok" | "warning" | "erreur" | "inactif" {
  if (!active) return "inactif";
  if (s === "ok") return "ok";
  if (s === "erreur") return "erreur";
  return "warning";
}

function pushAction(list: PlanAction[], a: PlanAction): void {
  // éviter doublons par id
  if (list.some((x) => x.id === a.id)) return;
  list.push(a);
}

export function computeSitePlan(input: SitePlanInput): {
  fineStatus: GlobalSiteStatusFine;
  fineLabel: string;
  legacyStatus: "ok" | "warning" | "erreur" | "inactif";
  priority: SitePriority;
  riskScore: number;
  nextAction: string | null;
  actions: PlanAction[];
  reasons: string[];
  daysSinceActivity: number | null;
} {
  const a = input.audit;
  const days = daysSince(input.lastActivityAt);

  let risk = 0;
  const reasons: string[] = [];

  if (!input.active) {
    risk += 25;
    reasons.push("Site inactif");
  }

  if (!input.settingsPresent) {
    risk += 25;
    reasons.push("Configuration non enregistrée");
  }

  if (!input.stripeConnected) {
    risk += 40;
    reasons.push("Stripe non connecté");
  } else if (!input.stripeOk) {
    risk += 20;
    reasons.push("Stripe onboarding incomplet");
  }

  if (a.readinessScore < 70) {
    risk += 30;
    reasons.push("Contenu incomplet (score bas)");
  } else if (a.readinessScore < 85) {
    risk += 15;
    reasons.push("Contenu à améliorer");
  }

  if (a.missingRequiredFields.length > 0) {
    risk += 20;
    reasons.push("Champs requis manquants");
  }
  if (a.placeholderFieldsCount > 0) {
    risk += 10;
    reasons.push("Textes de template détectés");
  }
  if (a.corruptedTextFieldsCount > 0) {
    risk += 10;
    reasons.push("Accents/encodage suspects");
  }

  if (input.errorsCount > 0) {
    risk += clamp(input.errorsCount * 4, 4, 20);
    reasons.push("Erreurs récentes");
  }
  if (input.emailFailedCount > 0) {
    risk += clamp(input.emailFailedCount * 3, 3, 15);
    reasons.push("Emails échoués");
  }
  if (input.paymentFailedCount > 0) {
    risk += clamp(input.paymentFailedCount * 5, 5, 20);
    reasons.push("Paiements échoués");
  }
  if (input.calculatorFailedCount > 0) {
    risk += clamp(input.calculatorFailedCount * 2, 2, 12);
    reasons.push("Erreurs calculateur");
  }

  if (days != null) {
    if (days >= 45) { risk += 25; reasons.push("Inactivité prolongée"); }
    else if (days >= 30) { risk += 20; reasons.push("Aucune activité récente (30j+)"); }
    else if (days >= 14) { risk += 10; reasons.push("Aucune activité récente (14j+)"); }
  }

  if (input.pricingSuspect) {
    risk += 15;
    reasons.push("Configuration tarifs suspecte");
  }

  risk = clamp(risk, 0, 100);
  const priority = priorityFromScore(risk);

  let fineStatus: GlobalSiteStatusFine = "ok";
  if (!input.active) fineStatus = "a_configurer";
  else if (!input.settingsPresent) fineStatus = "a_configurer";
  else if (risk >= 70) fineStatus = "erreur";
  else if (risk >= 45) fineStatus = "risque";
  else if (risk >= 25) fineStatus = "incomplet";
  else if (risk >= 10) fineStatus = "a_configurer";

  const actions: PlanAction[] = [];

  // Actions : max 1–3 en UI list, mais on en calcule plus pour fiche site.
  if (!input.settingsPresent) {
    pushAction(actions, {
      id: "save_settings",
      action: "Enregistrer la configuration du site",
      pourquoi: "Aucune configuration persistée n’a été détectée côté API.",
      gravite: "critique",
      statut: "a_faire",
    });
  }
  if (a.missingRequiredFields.length > 0) {
    pushAction(actions, {
      id: "fill_identity",
      action: "Compléter l’identité du site (nom, email, téléphone, URL)",
      pourquoi: "Des champs requis sont manquants: " + a.missingRequiredFields.slice(0, 3).join(", ") + (a.missingRequiredFields.length > 3 ? "…" : ""),
      gravite: "critique",
      statut: "a_faire",
    });
  }
  if (!input.stripeConnected) {
    pushAction(actions, {
      id: "connect_stripe",
      action: "Connecter Stripe (Stripe Connect)",
      pourquoi: "Aucun compte Stripe Connect n’est associé au site.",
      gravite: "critique",
      statut: "a_faire",
    });
  } else if (!input.stripeOk) {
    pushAction(actions, {
      id: "finish_stripe",
      action: "Finaliser l’onboarding Stripe (charges/détails)",
      pourquoi: "Le compte Stripe n’est pas encore prêt à encaisser.",
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (a.placeholderFieldsCount > 0) {
    pushAction(actions, {
      id: "remove_placeholders",
      action: "Remplacer les textes “Exemple / Adresse à compléter”",
      pourquoi: "Des placeholders ont été détectés dans le contenu.",
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (a.corruptedTextFieldsCount > 0) {
    pushAction(actions, {
      id: "fix_encoding",
      action: "Corriger les accents / l’encodage (UTF-8)",
      pourquoi: "Des caractères corrompus ont été détectés.",
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (input.calculatorFailedCount > 0) {
    pushAction(actions, {
      id: "test_calculator",
      action: "Tester le calculateur et corriger les erreurs",
      pourquoi: `${input.calculatorFailedCount} erreur(s) de calcul détectée(s) sur la période.`,
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (input.emailFailedCount > 0) {
    pushAction(actions, {
      id: "check_emails",
      action: "Vérifier l’envoi d’emails (SMTP / destinataires)",
      pourquoi: `${input.emailFailedCount} email(s) en échec sur la période.`,
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (input.paymentFailedCount > 0) {
    pushAction(actions, {
      id: "check_payments",
      action: "Vérifier les paiements échoués (Stripe / webhooks)",
      pourquoi: `${input.paymentFailedCount} paiement(s) en échec sur la période.`,
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (input.errorsCount > 0) {
    pushAction(actions, {
      id: "check_errors",
      action: "Analyser les erreurs récentes (API / admin)",
      pourquoi: `${input.errorsCount} erreur(s) détectée(s) sur la période.`,
      gravite: "warning",
      statut: "a_faire",
    });
  }
  if (days != null && days >= 14) {
    pushAction(actions, {
      id: "no_activity",
      action: "Relancer le client (site sans activité récente)",
      pourquoi: `Aucune activité notable depuis ${days} jour(s).`,
      gravite: days >= 45 ? "warning" : "info",
      statut: "a_faire",
    });
  }
  if (input.pricingSuspect) {
    pushAction(actions, {
      id: "pricing_suspect",
      action: "Vérifier la configuration tarifs (valeurs suspectes)",
      pourquoi: "Des valeurs de pricing semblent incohérentes ou à risque (lecture seule).",
      gravite: "warning",
      statut: "a_faire",
    });
  }

  // Marquer quelques items OK pour la checklist (utile fiche site)
  if (input.stripeConnected && input.stripeOk) {
    pushAction(actions, {
      id: "stripe_ok",
      action: "Stripe connecté",
      pourquoi: "Le compte Stripe est prêt à encaisser.",
      gravite: "info",
      statut: "ok",
    });
  }
  if (a.readinessScore >= 85 && a.placeholderFieldsCount === 0 && a.corruptedTextFieldsCount === 0 && a.missingRequiredFields.length === 0) {
    pushAction(actions, {
      id: "content_ok",
      action: "Contenu principal OK",
      pourquoi: "Identité et contenu semblent prêts (audit).",
      gravite: "info",
      statut: "ok",
    });
  }

  // Ordonner actions (critique > warning > info), puis “à faire” d’abord
  const gravRank = (g: PlanAction["gravite"]) => (g === "critique" ? 3 : g === "warning" ? 2 : 1);
  actions.sort((x, y) => {
    if (x.statut !== y.statut) return x.statut === "a_faire" ? -1 : 1;
    return gravRank(y.gravite) - gravRank(x.gravite);
  });

  const nextAction = actions.find((x) => x.statut === "a_faire")?.action ?? null;

  return {
    fineStatus,
    fineLabel: fineStatusLabel(fineStatus),
    legacyStatus: legacyStatusFromFine(fineStatus, input.active),
    priority,
    riskScore: risk,
    nextAction,
    actions,
    reasons: Array.from(new Set(reasons)).slice(0, 6),
    daysSinceActivity: days,
  };
}

