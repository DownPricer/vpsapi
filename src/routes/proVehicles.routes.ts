import { Router } from "express";
import multer from "multer";
import {
  proAddPhoto,
  proArchiveVehicle,
  proCoverPhoto,
  proCreateBlock,
  proCreateVehicle,
  proDeleteBlock,
  proFeatureVehicle,
  proGetVehicle,
  proListBlocks,
  proListVehicles,
  proPhotoAlt,
  proRemovePhoto,
  proReorderPhotos,
  proReplacePhoto,
  proRestoreVehicle,
  proUpdateVehicle,
  proVehicleCalendar,
} from "../controllers/vehicles.controller";
import { MAX_UPLOAD_BYTES, PhotoUploadError } from "../modules/fleet/photoStorage";

/** Fichier gardé en mémoire uniquement le temps d'être décodé/ré-encodé par sharp (jamais écrit tel quel). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

const single = (field: string): import("express").RequestHandler => (req, res, next) => {
  upload.single(field)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(
        err.code === "LIMIT_FILE_SIZE"
          ? new PhotoUploadError("Fichier trop volumineux (8 Mo maximum).", "FILE_TOO_LARGE", 413)
          : new PhotoUploadError("Envoi invalide.", "UPLOAD_ERROR", 400)
      );
    }
    next(err);
  });
};

export const proVehiclesRoutes = Router();

proVehiclesRoutes.get("/vehicles", proListVehicles);
proVehiclesRoutes.post("/vehicles", proCreateVehicle);
proVehiclesRoutes.get("/vehicle-calendar", proVehicleCalendar);
proVehiclesRoutes.delete("/vehicle-blocks/:blockId", proDeleteBlock);
proVehiclesRoutes.get("/vehicles/:id", proGetVehicle);
proVehiclesRoutes.patch("/vehicles/:id", proUpdateVehicle);
proVehiclesRoutes.post("/vehicles/:id/featured", proFeatureVehicle);
proVehiclesRoutes.post("/vehicles/:id/archive", proArchiveVehicle);
proVehiclesRoutes.post("/vehicles/:id/restore", proRestoreVehicle);
proVehiclesRoutes.get("/vehicles/:id/blocks", proListBlocks);
proVehiclesRoutes.post("/vehicles/:id/blocks", proCreateBlock);
proVehiclesRoutes.post("/vehicles/:id/photos", single("file"), proAddPhoto);
proVehiclesRoutes.put("/vehicles/:id/photos/order", proReorderPhotos);
proVehiclesRoutes.put("/vehicles/:id/photos/:photoId", single("file"), proReplacePhoto);
proVehiclesRoutes.patch("/vehicles/:id/photos/:photoId", proPhotoAlt);
proVehiclesRoutes.delete("/vehicles/:id/photos/:photoId", proRemovePhoto);
proVehiclesRoutes.post("/vehicles/:id/photos/:photoId/cover", proCoverPhoto);
