import webpush from "web-push";
import { PushSendError, type PushKeys, type PushSender, type VapidConfig } from "./push.types";

/** Expéditeur réel (bibliothèque web-push). Les clés VAPID viennent de l'environnement, jamais du code. */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: VapidConfig) {}

  async send(subscription: { endpoint: string; keys: PushKeys }, payload: string): Promise<void> {
    try {
      await webpush.sendNotification(subscription, payload, {
        vapidDetails: this.vapid,
        TTL: 60 * 60 * 12,
        urgency: "high",
        timeout: 10_000,
      });
    } catch (e) {
      const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : null;
      // Message volontairement générique : l'erreur d'origine peut contenir l'endpoint.
      throw new PushSendError("Envoi push échoué", status);
    }
  }
}
