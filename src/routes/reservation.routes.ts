import { Router } from "express";
import { postReservation } from "../controllers/reservation.controller";

export const reservationRoutes = Router();

reservationRoutes.post("/", postReservation);
