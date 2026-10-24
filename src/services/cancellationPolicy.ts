import { z } from "zod";

/**
 * Politique d'annulation configurable par chaque VTC.
 * Aucune pénalité automatique : ces textes informent le client ; le chauffeur décide au cas par cas.
 */
export const cancellationPolicyInputSchema = z
  .object({
    /** Délai (en heures avant le départ) jusqu'auquel l'annulation est gratuite ; null = non précisé. */
    freeCancellationHours: z.number().int().min(0).max(24 * 60).nullable(),
    partialRefundConditions: z.string().trim().max(1500).default(""),
    lateCancellationConditions: z.string().trim().max(1500).default(""),
    specialReasons: z.string().trim().max(1500).default(""),
    customerText: z.string().trim().max(3000).default(""),
  })
  .strict();

export type CancellationPolicyInput = z.infer<typeof cancellationPolicyInputSchema>;

export type CancellationPolicy = CancellationPolicyInput & {
  version: number;
  updatedAt: string;
};

export type CancellationPolicySnapshot = {
  policy: CancellationPolicy;
  capturedAt: string;
  source: "reservation" | "payment";
};

export function isPolicyContentEmpty(p: CancellationPolicyInput): boolean {
  return (
    p.freeCancellationHours === null &&
    !p.partialRefundConditions &&
    !p.lateCancellationConditions &&
    !p.specialReasons &&
    !p.customerText
  );
}

export function parseStoredPolicy(raw: unknown): CancellationPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const parsed = cancellationPolicyInputSchema.safeParse({
    freeCancellationHours: o.freeCancellationHours ?? null,
    partialRefundConditions: o.partialRefundConditions ?? "",
    lateCancellationConditions: o.lateCancellationConditions ?? "",
    specialReasons: o.specialReasons ?? "",
    customerText: o.customerText ?? "",
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    version: typeof o.version === "number" && Number.isInteger(o.version) ? o.version : 1,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString(),
  };
}

export function parseStoredSnapshot(raw: unknown): CancellationPolicySnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const policy = parseStoredPolicy(o.policy);
  if (!policy) return null;
  return {
    policy,
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : policy.updatedAt,
    source: o.source === "payment" ? "payment" : "reservation",
  };
}

export function nextPolicy(input: CancellationPolicyInput, previous: CancellationPolicy | null, now = new Date()): CancellationPolicy {
  return { ...input, version: (previous?.version ?? 0) + 1, updatedAt: now.toISOString() };
}

export function buildPolicySnapshot(
  policy: CancellationPolicy | null,
  source: CancellationPolicySnapshot["source"],
  now = new Date()
): CancellationPolicySnapshot | null {
  if (!policy) return null;
  return { policy, capturedAt: now.toISOString(), source };
}

export type PolicyLine = { label: string; text: string };

export function policyLines(policy: CancellationPolicyInput): PolicyLine[] {
  const lines: PolicyLine[] = [];
  if (policy.freeCancellationHours !== null) {
    const h = policy.freeCancellationHours;
    lines.push({
      label: "Annulation gratuite",
      text:
        h === 0
          ? "Selon l'accord du chauffeur."
          : h % 24 === 0
            ? `Jusqu'à ${h / 24} jour${h / 24 > 1 ? "s" : ""} avant le départ.`
            : `Jusqu'à ${h} heure${h > 1 ? "s" : ""} avant le départ.`,
    });
  }
  if (policy.lateCancellationConditions) lines.push({ label: "Annulation tardive", text: policy.lateCancellationConditions });
  if (policy.partialRefundConditions) lines.push({ label: "Remboursement partiel", text: policy.partialRefundConditions });
  if (policy.specialReasons) lines.push({ label: "Motifs particuliers", text: policy.specialReasons });
  if (policy.customerText) lines.push({ label: "À savoir", text: policy.customerText });
  return lines;
}

/** Texte court (<= 1200 caractères) affichable sur la page de paiement Stripe. */
export function policyCheckoutMessage(policy: CancellationPolicyInput): string {
  const text = policyLines(policy)
    .map((l) => `${l.label} : ${l.text}`)
    .join(" — ");
  return text.length <= 1100 ? `Conditions d'annulation — ${text}` : `Conditions d'annulation — ${text.slice(0, 1060)}…`;
}
