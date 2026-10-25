import { Router } from "express";
import {
  getCancelPreview,
  getLeadCancellationRequest,
  postCancelBooking,
  postResolveCancellationRequest,
} from "../controllers/proCancellation.controller";
import { postDemandePaymentLink } from "../controllers/proDemandePayment.controller";
import { proChangeLeadVehicle, proRescheduleLead } from "../controllers/vehicles.controller";

export const proDemandesRoutes = Router();

proDemandesRoutes.post("/:id/payment-link", postDemandePaymentLink);
proDemandesRoutes.patch("/:id/vehicle", proChangeLeadVehicle);
proDemandesRoutes.patch("/:id/schedule", proRescheduleLead);
proDemandesRoutes.get("/:id/cancel-preview", getCancelPreview);
proDemandesRoutes.post("/:id/cancel", postCancelBooking);
proDemandesRoutes.get("/:id/cancellation-request", getLeadCancellationRequest);
proDemandesRoutes.post("/:id/cancellation-request/resolve", postResolveCancellationRequest);
