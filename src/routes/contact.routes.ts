import { Router } from "express";
import { postContact } from "../controllers/contact.controller";

export const contactRoutes = Router();

contactRoutes.post("/", postContact);
