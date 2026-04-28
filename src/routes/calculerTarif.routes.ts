import { Router } from "express";
import { postCalculerTarif } from "../controllers/calculerTarif.controller";

export const calculerTarifRoutes = Router();

calculerTarifRoutes.post("/", postCalculerTarif);
