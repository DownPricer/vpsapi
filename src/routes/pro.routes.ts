import { Router } from "express";
import {
  getProPaymentSettings,
  patchProPaymentSettings,
} from "../controllers/proPaymentSettings.controller";
import { getProPaymentsList } from "../controllers/proPaymentsList.controller";
import {
  getPendingCancellationRequests,
  getProCancellationPolicy,
  putProCancellationPolicy,
} from "../controllers/proCancellation.controller";
import {
  getProPaymentDetail,
  getProRefundPreview,
  postProPaymentSync,
  postProRefund,
} from "../controllers/proRefunds.controller";
import { getProTenantSettings, putProTenantSettings } from "../controllers/proSettings.controller";
import { proDemandesRoutes } from "./proDemandes.routes";
import { proPushRoutes } from "./proPush.routes";
import { proStripeRoutes } from "./proStripe.routes";
import { proVehiclesRoutes } from "./proVehicles.routes";

export const proRoutes = Router();

proRoutes.get("/settings", getProTenantSettings);
proRoutes.put("/settings", putProTenantSettings);
proRoutes.patch("/settings", putProTenantSettings);
proRoutes.get("/payment-settings", getProPaymentSettings);
proRoutes.patch("/payment-settings", patchProPaymentSettings);
proRoutes.get("/payments", getProPaymentsList);
proRoutes.get("/payments/:paymentId", getProPaymentDetail);
proRoutes.get("/payments/:paymentId/refund-preview", getProRefundPreview);
proRoutes.post("/payments/:paymentId/refunds", postProRefund);
proRoutes.post("/payments/:paymentId/sync", postProPaymentSync);
proRoutes.get("/cancellation-requests", getPendingCancellationRequests);
proRoutes.get("/cancellation-policy", getProCancellationPolicy);
proRoutes.put("/cancellation-policy", putProCancellationPolicy);
proRoutes.use(proVehiclesRoutes);
proRoutes.use("/demandes", proDemandesRoutes);
proRoutes.use("/stripe", proStripeRoutes);
proRoutes.use("/push", proPushRoutes);
