import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { loadEnv } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { tenantMiddleware } from "./middleware/tenant";
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
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/health", healthRoutes);

  app.use("/api", tenantMiddleware(env), createTenantApiRouter());

  app.use(errorHandler);

  return app;
}
