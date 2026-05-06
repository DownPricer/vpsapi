import { Router } from "express";
import { getPublicPaymentConfirmation } from "../controllers/publicPaymentConfirmation.controller";
import { getPublicTenantSettings } from "../controllers/publicTenantSettings.controller";

export const publicRoutes = Router();

publicRoutes.get("/tenant-settings", getPublicTenantSettings);
publicRoutes.get("/payment-confirmation", getPublicPaymentConfirmation);
