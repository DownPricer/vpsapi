import { Router } from "express";
import { platformAuthRoutes } from "./platformAuth.routes";
import { getPlatformAdminMe } from "./platformAuth.controller";
import { requirePlatformAdmin } from "./requirePlatformAdmin";
import { getPlatformHealth, getPlatformOverview } from "./platformOverview.controller";
import { getPlatformAlerts } from "./platformAlerts.controller";
import { getPlatformOverviewCharts, getPlatformSiteCharts } from "./platformCharts.controller";
import { getPlatformSitePlan } from "./platformPlan.controller";
import { getPlatformEventsGrouped } from "./platformEventsGrouped.controller";
import {
  addTenantDomain,
  confirmPlatformDomain,
  createPlatformTenant,
  createTenantFromDomain,
  getPlatformDomains,
  rejectPlatformDomain,
} from "./platformDomains.controller";
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

  router.get("/overview/charts", requirePlatformAdmin, (req, res, next) => {
    void getPlatformOverviewCharts(req, res, next);
  });

  router.get("/alerts", requirePlatformAdmin, (req, res, next) => {
    void getPlatformAlerts(req, res, next);
  });

  router.get("/sites", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSites(req, res, next);
  });

  router.post("/tenants", requirePlatformAdmin, (req, res, next) => {
    void createPlatformTenant(req, res, next);
  });

  router.post("/tenants/:tenantId/domains", requirePlatformAdmin, (req, res, next) => {
    void addTenantDomain(req, res, next);
  });

  router.get("/domains", requirePlatformAdmin, (req, res, next) => {
    void getPlatformDomains(req, res, next);
  });

  router.post("/domains/:id/confirm", requirePlatformAdmin, (req, res, next) => {
    void confirmPlatformDomain(req, res, next);
  });

  router.post("/domains/:id/create-tenant", requirePlatformAdmin, (req, res, next) => {
    void createTenantFromDomain(req, res, next);
  });

  router.post("/domains/:id/reject", requirePlatformAdmin, (req, res, next) => {
    void rejectPlatformDomain(req, res, next);
  });

  router.get("/sites/:tenantId", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteByTenantId(req, res, next);
  });

  router.get("/sites/:tenantId/metrics", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteMetrics(req, res, next);
  });

  router.get("/sites/:tenantId/charts", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSiteCharts(req, res, next);
  });

  router.get("/sites/:tenantId/plan", requirePlatformAdmin, (req, res, next) => {
    void getPlatformSitePlan(req, res, next);
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

  router.get("/events/grouped", requirePlatformAdmin, (req, res, next) => {
    void getPlatformEventsGrouped(req, res, next);
  });

  return router;
}

