/** Préférence « lien paiement en ligne » envoyée par les formulaires publics (calculateur / devis). */
export function parseClientWantsOnlinePayment(body: Record<string, unknown>): boolean {
  const root = body.clientWantsOnlinePayment;
  if (typeof root === "boolean") return root;
  if (root === "true") return true;
  if (root === "false") return false;

  const client = body.client;
  if (client && typeof client === "object" && !Array.isArray(client)) {
    const c = client as Record<string, unknown>;
    if (typeof c.clientWantsOnlinePayment === "boolean") return c.clientWantsOnlinePayment;
    if (c.clientWantsOnlinePayment === "true") return true;
  }
  return false;
}
