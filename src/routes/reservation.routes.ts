import { Router } from "express";
import { postReservation } from "../controllers/reservation.controller";
import { createPublicRouteRateLimiter } from "../middleware/publicRateLimit";

export const reservationRoutes = Router();

reservationRoutes.post("/", createPublicRouteRateLimiter("reservation", 10), postReservation);
