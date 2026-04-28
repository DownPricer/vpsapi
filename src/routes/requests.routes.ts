import { Router } from "express";
import { patchRequestNote, patchRequestStatus, getRequestById, getRequests } from "../controllers/requests.controller";

export const requestsRoutes = Router();

requestsRoutes.get("/", getRequests);
requestsRoutes.get("/:id", getRequestById);
requestsRoutes.patch("/:id/status", patchRequestStatus);
requestsRoutes.patch("/:id/note", patchRequestNote);
