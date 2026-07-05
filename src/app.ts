import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { loadEnv } from "./config/env";
import { postStripeWebhook } from "./controllers/stripeWebhook.controller";
import { jsonUtf8Middleware } from "./middleware/jsonUtf8";
import { errorHandler } from "./middleware/errorHandler";
import { tenantMiddleware } from "./middleware/tenant";
import { adminRoutes } from "./platform/admin.routes";
import { createPlatformRouter } from "./platform/platform.routes";
import { telemetryRoutes } from "./platform/telemetry.routes";
import { healthRoutes } from "./routes/health.routes";
import { createTenantApiRouter } from "./routes";

export function createApp(): express.Application {
  const env = loadEnv();
  const app = express();

  const corsOptions: cors.CorsOptions = {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
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
