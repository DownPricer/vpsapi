import { RefundMailNotifier } from "../modules/email/cancellationMail";
import { PrismaRefundStore } from "./stripe/prismaRefundStore";
import { RefundService } from "./stripe/refund.service";
import { getRefundStripeGateway } from "./stripe/stripeRefundGateway";

let instance: RefundService | null = null;

/** Instance partagée (contrôleurs + webhooks) : une seule implémentation du flux de remboursement. */
export function getRefundService(): RefundService {
  if (!instance) {
    instance = new RefundService({
      store: new PrismaRefundStore(),
      gateway: getRefundStripeGateway,
      notifier: new RefundMailNotifier(),
    });
  }
  return instance;
}

/** Réservé aux tests : remplace l'instance partagée (aucun effet en production). */
export function setRefundServiceForTests(service: RefundService | null): void {
  instance = service;
}
