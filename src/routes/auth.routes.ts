import { Router } from "express";
import { getAuthMe, postAuthLogin, postAuthLogout, postAuthRefresh } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { combineRateLimiters, createRateLimiter, resolveTrustedProxyIp } from "../middleware/rateLimit";

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

/** Par e-mail seul : un attaquant multi-IP ne contourne pas le plafond du compte. */
const loginByEmail = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: "auth-login-email",
  keyFrom: (req) => {
    const email = loginEmail(req);
    if (!email) return null;
    return `auth-login-email:${email}`;
  },
});

authRoutes.post("/login", combineRateLimiters(loginByIpEmail, loginByEmail), postAuthLogin);
authRoutes.post("/refresh", postAuthRefresh);
authRoutes.post("/logout", postAuthLogout);
authRoutes.get("/me", requireAuth, getAuthMe);
