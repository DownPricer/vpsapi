import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import path from "path";
import { loadEnv } from "./config/env";
import { postStripeWebhook } from "./controllers/stripeWebhook.controller";
import { jsonUtf8Middleware } from "./middleware/jsonUtf8";
import { errorHandler } from "./middleware/errorHandler";
import { tenantMiddleware } from "./middleware/tenant";
import { isActiveTenantOrigin } from "./tenancy/corsOrigin";
import { adminRoutes } from "./platform/admin.routes";
import { createPlatformRouter } from "./platform/platform.routes";
import { telemetryRoutes } from "./platform/telemetry.routes";
import { healthRoutes } from "./routes/health.routes";
import { createTenantApiRouter } from "./routes";
import { getUploadsRoot } from "./modules/fleet/photoStorage";

export function createApp(): express.Application {
  const env = loadEnv();
  const app = express();

  /**
   * CORS : sans liste CORS_ORIGINS, tout est accepté (comportement historique). Avec une liste, une origine
   * est acceptée si elle y figure ou si c'est un domaine actif d'un tenant (nouveaux clients sans redémarrage).
   */
  const corsOptions: cors.CorsOptions = {
    origin:
      env.corsOrigins.length > 0
        ? (origin, callback) => {
            if (!origin || env.corsOrigins.includes(origin)) {
              callback(null, true);
              return;
            }
            isActiveTenantOrigin(origin).then(
              (allowed) => callback(null, allowed),
              () => callback(null, false)
            );
          }
        : true,
    credentials: true,
  };
  app.use(cors(corsOptions));
  app.use(jsonUtf8Middleware);
  /** Stripe webhook : body brut obligatoire pour la signature — avant express.json(). */
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req, res, next) => {
      void postStripeWebhook(req, res, next);
    }
  );
  /**
   * Médias uploadés (photos de véhicules) : dossier persistant UPLOADS_DIR, URLs `/media/vehicles/<tenantId>/<uuid>.webp`.
   * Publics par nature (affichés sur le site), noms non devinables, nosniff + cache long (le nom change à chaque remplacement).
   */
  app.use(
    "/media",
    express.static(path.join(getUploadsRoot()), {
      index: false,
      dotfiles: "ignore",
      maxAge: "365d",
      immutable: true,
      setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/health", healthRoutes);

  // UI super-admin servie par l’API (protégée par cookie plateforme).
  app.use("/admin", adminRoutes);

  // Plateforme (super-admin) : routes globales hors tenantMiddleware.
  app.use("/api/platform", createPlatformRouter());

  // Télémétrie publique (RGPD-friendly), globale hors tenantMiddleware.
  app.use("/api/telemetry", telemetryRoutes);

  app.use("/api", tenantMiddleware(env), createTenantApiRouter());

  app.use(errorHandler);

  return app;
}
