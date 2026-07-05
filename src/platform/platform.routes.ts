import { Router } from "express";
import { platformAuthRoutes } from "./platformAuth.routes";
import { getPlatformAdminMe } from "./platformAuth.controller";
import { requirePlatformAdmin } from "./requirePlatformAdmin";
import { getPlatformHealth, getPlatformOverview } from "./platformOverview.controller";
import {
  getPlatformEvents,
  getPlatformSiteByTenantId,
  getPlatformSiteAudit,
  getPlatformSiteEvents,
  getPlatformSiteMetrics,
  getPlatformSites,
} from "./platformSites.controller";

export function createPlatformRouter(): Router {
  const router = Router();

  router.use("/auth", platformAuthRoutes);
  router.get("/me", requirePlatformAdmin, (req, res) => {
    void getPlatformAdminMe(req, res);
  });

  router.get("/health", requirePlatformAdmin, (req, res) => {
    void getPlatformHealth(req, res);
  });

  router.get("/overview", requirePlatformAdmin, (req, res, next) => {
    void getPlatformOverview(req, res, next);
  });

  router.get("/sites", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSites(req, res, next);
  });

  router.get("/sites/:tenantId", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteByTenantId(req, res, next);
  });

  router.get("/sites/:tenantId/metrics", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteMetrics(req, res, next);
  });

  router.get("/sites/:tenantId/audit", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteAudit(req, res, next);
  });

  router.get("/sites/:tenantId/events", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteEvents(req, res, next);
  });

  router.get("/events", requirePlatformAdmin, (req, res, next) => {
    void getPlatformEvents(req, res, next);
  });

  return router;
}

