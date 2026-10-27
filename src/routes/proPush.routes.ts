import { Router } from "express";
import { deletePushSubscribe, getPushPublicKey, postPushSubscribe } from "../controllers/proPush.controller";

export const proPushRoutes = Router();

proPushRoutes.get("/public-key", getPushPublicKey);
proPushRoutes.post("/subscribe", postPushSubscribe);
proPushRoutes.delete("/subscribe", deletePushSubscribe);
