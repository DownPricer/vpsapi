/** Événements métier qui déclenchent une notification push vers l'espace pro. */
export type PushEventKind = "new_request" | "payment_confirmed" | "cancellation_request";

/** Contenu envoyé à l'appareil : strictement générique, aucune donnée personnelle. */
export interface PushPayload {
  title: string;
  body: string;
  /** Lien profond relatif, toujours sous /pro/. */
  url: string;
  tag: string;
}

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface StoredPushSubscription {
  id: string;
  tenantId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface UpsertPushSubscriptionInput {
  tenantId: string;
  userId: string;
  endpoint: string;
  keys: PushKeys;
  userAgent: string | null;
}

/** Accès aux abonnements. Toute lecture/suppression est bornée par `tenantId`. */
export interface PushStore {
  /** Abonnements des opérateurs actifs du tenant. */
  listForTenant(tenantId: string): Promise<StoredPushSubscription[]>;
  /** Crée ou met à jour par endpoint (un endpoint existant est réaffecté à l'utilisateur courant). */
  upsert(input: UpsertPushSubscriptionInput): Promise<void>;
  /** Ne garde que les `keep` abonnements les plus récents de l'utilisateur ; renvoie le nombre supprimé. */
  trimUser(tenantId: string, userId: string, keep: number): Promise<number>;
  /** Supprime l'abonnement de CET utilisateur dans CE tenant ; renvoie le nombre supprimé. */
  deleteForUser(tenantId: string, userId: string, endpoint: string): Promise<number>;
  deleteById(tenantId: string, id: string): Promise<void>;
  touch(tenantId: string, ids: string[]): Promise<void>;
}

export class PushSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null
  ) {
    super(message);
    this.name = "PushSendError";
  }
}

export interface PushSender {
  /** Lève `PushSendError` ; `statusCode` 404/410 = abonnement expiré. */
  send(subscription: { endpoint: string; keys: PushKeys }, payload: string): Promise<void>;
}

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface NotifyResult {
  sent: number;
  removed: number;
  failed: number;
}
