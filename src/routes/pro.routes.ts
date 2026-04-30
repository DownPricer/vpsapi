import { Router } from "express";
import { getProTenantSettings, putProTenantSettings } from "../controllers/proSettings.controller";

export const proRoutes = Router();

proRoutes.get("/settings", getProTenantSettings);
proRoutes.put("/settings", putProTenantSettings);
proRoutes.patch("/settings", putProTenantSettings);
