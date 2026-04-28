import { Router } from "express";
import { postDevis } from "../controllers/devis.controller";

export const devisRoutes = Router();

devisRoutes.post("/", postDevis);
