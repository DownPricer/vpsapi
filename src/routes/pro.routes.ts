import { Router } from "express";
import {
  getProPaymentSettings,
  patchProPaymentSettings,
} from "../controllers/proPaymentSettings.controller";
import { getProPaymentsList } from "../controllers/proPaymentsList.controller";
import { getProTenantSettings, putProTenantSettings } from "../controllers/proSettings.controller";
import { proDemandesRoutes } from "./proDemandes.routes";
import { proStripeRoutes } from "./proStripe.routes";

export const proRoutes = Router();

proRoutes.get("/settings", getProTenantSettings);
proRoutes.put("/settings", putProTenantSettings);
proRoutes.patch("/settings", putProTenantSettings);
proRoutes.get("/payment-settings", getProPaymentSettings);
proRoutes.patch("/payment-settings", patchProPaymentSettings);
proRoutes.get("/payments", getProPaymentsList);
proRoutes.use("/demandes", proDemandesRoutes);
proRoutes.use("/stripe", proStripeRoutes);
