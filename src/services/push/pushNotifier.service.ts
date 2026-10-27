import {
  PushSendError,
  type NotifyResult,
  type PushEventKind,
  type PushPayload,
  type PushSender,
  type PushStore,
  type VapidConfig,
  type PushKeys,
} from "./push.types";

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MESSAGES: Record<PushEventKind, { title: string; body: string }> = {
  new_request: { title: "Nouvelle demande", body: "Une nouvelle demande vous attend dans votre espace pro." },
  payment_confirmed: { title: "Paiement reçu", body: "Un paiement vient d'être confirmé." },
  cancellation_request: { title: "Demande d'annulation", body: "Un client demande l'annulation d'une réservation." },
};

/** Titre générique + lien profond vers la fiche (identifiant opaque) : aucune donnée personnelle. */
export function buildPushPayload(kind: PushEventKind, leadId?: string | null): PushPayload {
  const safeLeadId = leadId && SAFE_ID.test(leadId) ? leadId : null;
  const { title, body } = MESSAGES[kind];
  return {
    title,
    body,
    url: safeLeadId ? `/pro/demandes/${safeLeadId}` : "/pro/demandes",
    tag: safeLeadId ? `${kind}:${safeLeadId}` : kind,
  };
}

/** Lit la config VAPID ; `null` (push désactivé) si une variable manque ou si le sujet est invalide. */
export function readVapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { subject, publicKey, privateKey };
}

export class PushNotifier {
  constructor(
    private readonly store: PushStore,
    private readonly sender: PushSender,
    private readonly vapid: VapidConfig | null
  ) {}

  isConfigured(): boolean {
    return this.vapid !== null;
  }

  getPublicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async subscribe(input: {
    tenantId: string;
    userId: string;
    endpoint: string;
    keys: PushKeys;
    userAgent?: string | null;
  }): Promise<void> {
    await this.store.upsert({
      tenantId: input.tenantId,
      userId: input.userId,
      endpoint: input.endpoint,
      keys: input.keys,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });
    await this.store.trimUser(input.tenantId, input.userId, MAX_SUBSCRIPTIONS_PER_USER);
  }

  async unsubscribe(input: { tenantId: string; userId: string; endpoint: string }): Promise<boolean> {
    const count = await this.store.deleteForUser(input.tenantId, input.userId, input.endpoint);
    return count > 0;
  }

  /** Notifie tous les appareils abonnés du tenant. Ne lève jamais : un échec push ne doit rien casser. */
  async notifyTenant(tenantId: string, kind: PushEventKind, leadId?: string | null): Promise<NotifyResult> {
    const result: NotifyResult = { sent: 0, removed: 0, failed: 0 };
    if (!this.vapid) return result;

    let subscriptions;
    try {
      // Défense en profondeur : même si le store se trompe, on n'envoie jamais hors du tenant demandé.
      subscriptions = (await this.store.listForTenant(tenantId)).filter((s) => s.tenantId === tenantId);
    } catch (e) {
      console.error("[push] lecture des abonnements impossible", e instanceof Error ? e.name : "unknown");
      return result;
    }
    if (subscriptions.length === 0) return result;

    const payload = JSON.stringify(buildPushPayload(kind, leadId));
    const delivered: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await this.sender.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          result.sent += 1;
          delivered.push(sub.id);
        } catch (e) {
          const status = e instanceof PushSendError ? e.statusCode : null;
          if (status === 404 || status === 410) {
            result.removed += 1;
            await this.store.deleteById(tenantId, sub.id).catch(() => undefined);
          } else {
            result.failed += 1;
            // Ni endpoint ni clés dans les logs.
            console.warn("[push] envoi échoué", { subscriptionId: sub.id, status });
          }
        }
      })
    );

    if (delivered.length > 0) await this.store.touch(tenantId, delivered).catch(() => undefined);
    return result;
  }
}
