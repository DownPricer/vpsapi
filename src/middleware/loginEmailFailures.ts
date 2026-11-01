import { createFailureCounter } from "./rateLimit";

/** Plafond de connexions échouées par e-mail (succès → reset). */
export const loginEmailFailures = createFailureCounter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "auth-login-email-fail",
});
