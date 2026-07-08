import type { NextFunction, Request, Response } from "express";
import type { AppEnv } from "../config/env";
import { getTenantConfig } from "../config/tenants/registry";
import { resolveTenantFromRequest } from "../tenancy/domainResolver";
import { sendTenantNotFound } from "../utils/apiResponse";

export function tenantMiddleware(env: AppEnv) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resolution = await resolveTenantFromRequest(req, {
        fallbackTenantId: env.defaultTenantId,
        allowPendingCreate: true,
        allowHeaderForPendingDomain: req.path === "/auth/login",
        metadata: req.body?.metadata ?? req.body,
      });
      if (resolution.source === "pending_domain" && resolution.observedDomain) {
        console.warn("[tenant] DOMAIN_PENDING", {
          path: req.path,
          origin: resolution.origin,
          observedDomain: resolution.observedDomain,
          matchedDomain: resolution.matchedDomain,
          domainStatus: resolution.domainStatus,
        });
        res.status(409).json({
          success: false,
          error: {
            code: "DOMAIN_PENDING",
            message: "Domaine détecté mais non confirmé. Associez ce domaine à un tenant dans le super-admin.",
            domain: resolution.observedDomain,
          },
        });
        return;
      }
      const tenantId = resolution.tenantId ?? env.defaultTenantId;

      const tenantConfig = getTenantConfig(tenantId);
      const fallbackConfig = tenantConfig ? null : getTenantConfig(env.defaultTenantId);
      const tenant = tenantConfig ?? (fallbackConfig ? { ...fallbackConfig, id: tenantId } : undefined);
      if (!tenant) {
        sendTenantNotFound(res, tenantId);
        return;
      }

      req.tenantId = tenantId;
      req.tenant = tenant;
      req.tenantResolution = {
        tenantId,
        source:
          resolution.source === "domain_active"
            ? "domain_active"
            : resolution.source === "header"
              ? "header"
              : "fallback_default",
        observedDomain: resolution.observedDomain,
        matchedDomain: resolution.matchedDomain,
        domainStatus: resolution.domainStatus,
        origin: resolution.origin,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}
