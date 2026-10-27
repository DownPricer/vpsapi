import { PrismaPushStore } from "./prismaPushStore";
import { PushNotifier, readVapidConfig } from "./pushNotifier.service";
import type { PushEventKind, PushSender } from "./push.types";
import { WebPushSender } from "./webPushSender";

let instance: PushNotifier | null = null;

const NOOP_SENDER: PushSender = {
  async send() {
    throw new Error("Push non configuré");
  },
};

/** Notifier de l'application (singleton) : sans clés VAPID, il reste inactif. */
export function getPushNotifier(): PushNotifier {
  if (!instance) {
    const vapid = readVapidConfig();
    instance = new PushNotifier(new PrismaPushStore(), vapid ? new WebPushSender(vapid) : NOOP_SENDER, vapid);
  }
  return instance;
}

/** Envoi « fire and forget » depuis les services métier : n'attend rien et ne casse jamais le flux appelant. */
export function notifyTenantPush(tenantId: string, kind: PushEventKind, leadId?: string | null): void {
  try {
    void getPushNotifier()
      .notifyTenant(tenantId, kind, leadId)
      .catch(() => undefined);
  } catch {
    // Jamais d'exception vers l'appelant.
  }
}
