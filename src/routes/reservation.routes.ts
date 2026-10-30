import { Router } from "express";
import { postReservation } from "../controllers/reservation.controller";
import { createRateLimiter } from "../middleware/rateLimit";

export const reservationRoutes = Router();

const reservationLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  key: "reservation",
  requireClientIpHeader: true,
});

reservationRoutes.post("/", reservationLimiter, postReservation);
