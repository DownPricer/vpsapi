import { Router } from "express";
import { getAuthMe, postAuthLogin, postAuthLogout, postAuthRefresh } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { createRateLimiter, resolveRateLimitClientIp } from "../middleware/rateLimit";

export const authRoutes = Router();

/** Connexion pro : navigateur → API (IP réelle via Nginx). Clé = IP + e-mail. */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  key: "auth-login",
  keyFrom: (req) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `auth-login:${resolveRateLimitClientIp(req)}:${email || "noemail"}`;
  },
});

authRoutes.post("/login", loginLimiter, postAuthLogin);
authRoutes.post("/refresh", postAuthRefresh);
authRoutes.post("/logout", postAuthLogout);
authRoutes.get("/me", requireAuth, getAuthMe);
