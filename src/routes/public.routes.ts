import { Router } from "express";
import { getPublicTenantSettings } from "../controllers/publicTenantSettings.controller";

export const publicRoutes = Router();

publicRoutes.get("/tenant-settings", getPublicTenantSettings);
