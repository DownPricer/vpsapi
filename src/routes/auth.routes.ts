import { Router } from "express";
import { getAuthMe, postAuthLogin, postAuthLogout, postAuthRefresh } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { loginEmailFailures } from "../middleware/loginEmailFailures";
import { createRateLimiter, resolveTrustedProxyIp } from "../middleware/rateLimit";

export const authRoutes = Router();

function loginEmail(req: { body?: { email?: unknown } }): string {
  return typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
}

/** IP réelle (Nginx → req.ip) + e-mail : ignore X-Client-Ip / X-Forwarded-For client. */
const loginByIpEmail = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: "auth-login-ip",
  keyFrom: (req) => `auth-login-ip:${resolveTrustedProxyIp(req)}:${loginEmail(req) || "noemail"}`,
});

/** Plafond e-mail : uniquement les échecs (voir postAuthLogin + loginEmailFailures). */
function loginEmailFailureGate(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
): void {
  const email = loginEmail(req);
  if (!email) {
    next();
    return;
  }
  const state = loginEmailFailures.isLimited(email);
  if (state.limited) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Trop de tentatives. Réessayez dans quelques minutes." },
    });
    return;
  }
  next();
}

authRoutes.post("/login", loginByIpEmail, loginEmailFailureGate, postAuthLogin);
authRoutes.post("/refresh", postAuthRefresh);
authRoutes.post("/logout", postAuthLogout);
authRoutes.get("/me", requireAuth, getAuthMe);
