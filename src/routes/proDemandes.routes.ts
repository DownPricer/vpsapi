import { Router } from "express";
import { postDemandePaymentLink } from "../controllers/proDemandePayment.controller";

export const proDemandesRoutes = Router();

proDemandesRoutes.post("/:id/payment-link", postDemandePaymentLink);
