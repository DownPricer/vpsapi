import { Router } from "express";
import { postTelemetryEvent } from "./telemetry.controller";

export const telemetryRoutes = Router();

telemetryRoutes.post("/event", (req, res, next) => {
  void postTelemetryEvent(req, res, next);
});

