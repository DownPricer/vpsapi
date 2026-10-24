import { Router } from "express";
import {
  getPublicCancellationPolicy,
  postPublicBookingView,
  postPublicCancellationRequest,
} from "../controllers/publicBooking.controller";
import { getPublicPaymentConfirmation } from "../controllers/publicPaymentConfirmation.controller";
import { getPublicTenantSettings } from "../controllers/publicTenantSettings.controller";
import { createRateLimiter } from "../middleware/rateLimit";

export const publicRoutes = Router();

const bookingLookupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40, key: "booking-view" });
const bookingRequestLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, key: "booking-cancel" });

publicRoutes.get("/tenant-settings", getPublicTenantSettings);
publicRoutes.get("/payment-confirmation", getPublicPaymentConfirmation);
publicRoutes.get("/cancellation-policy", getPublicCancellationPolicy);
publicRoutes.post("/booking/view", bookingLookupLimiter, postPublicBookingView);
publicRoutes.post("/booking/cancellation-request", bookingRequestLimiter, postPublicCancellationRequest);
