import type { NextFunction, Request, Response } from "express";
import type { AppEnv } from "../config/env";
import { getTenantConfig } from "../config/tenants/registry";
import { sendTenantNotFound } from "../utils/apiResponse";

export function tenantMiddleware(env: AppEnv) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.headers["x-tenant-id"];
    const fromHeader = typeof raw === "string" ? raw.trim() : "";
    const tenantId = fromHeader.length > 0 ? fromHeader : env.defaultTenantId;

    const tenant = getTenantConfig(tenantId);
    if (!tenant) {
      sendTenantNotFound(res, tenantId);
      return;
    }

    req.tenantId = tenantId;
    req.tenant = tenant;
    next();
  };
}
