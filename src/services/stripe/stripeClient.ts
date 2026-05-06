import Stripe from "stripe";

type StripeClient = InstanceType<typeof Stripe>;

let cachedStripeClient: StripeClient | null | undefined;

function getStripeSecretKey(): string | undefined {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function isStripeConfigured(): boolean {
  return Boolean(getStripeSecretKey());
}

export function getStripeClient(): StripeClient | null {
  if (cachedStripeClient !== undefined) {
    return cachedStripeClient;
  }
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    cachedStripeClient = null;
    return cachedStripeClient;
  }
  cachedStripeClient = new Stripe(secretKey);
  return cachedStripeClient;
}
