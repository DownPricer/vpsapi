import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp, { type OutputInfo, type Sharp } from "sharp";

/**
 * Stockage des photos de véhicules.
 * - Dossier PERSISTANT hors du build : `UPLOADS_DIR` (défaut `<cwd>/uploads`) → à monter en volume sur le VPS.
 * - Rangement par tenant : `vehicles/<tenantId>/<uuid>.webp`, URL publique `/media/vehicles/<tenantId>/<uuid>.webp`.
 * - Le fichier envoyé n'est JAMAIS conservé tel quel : il est décodé (le format réel est vérifié par le contenu,
 *   pas par l'en-tête MIME/l'extension du client), orienté selon l'EXIF, redimensionné et ré-encodé en WebP
 *   (métadonnées EXIF/GPS supprimées). Le nom est généré côté serveur.
 */

export const MEDIA_PUBLIC_PREFIX = "/media";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_EDGE_PX = 1800;
const MAX_INPUT_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class PhotoUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

export function getUploadsRoot(): string {
  return path.resolve(process.env.UPLOADS_DIR?.trim() || path.join(process.cwd(), "uploads"));
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_FILE = /^[A-Za-z0-9-]{8,64}\.webp$/;

export function vehiclePhotoPublicUrl(tenantId: string, fileName: string): string {
  return `${MEDIA_PUBLIC_PREFIX}/vehicles/${tenantId}/${fileName}`;
}

/** Chemin disque d'une URL `/media/vehicles/<tenantId>/<file>.webp`, uniquement si elle appartient à CE tenant. */
export function resolveOwnedPhotoFile(tenantId: string, url: string): string | null {
  const m = /^\/media\/vehicles\/([^/]+)\/([^/?#]+)$/.exec(url.trim());
  if (!m) return null;
  const [, tid, file] = m;
  if (tid !== tenantId || !SAFE_SEGMENT.test(tid) || !SAFE_FILE.test(file)) return null;
  const root = path.resolve(getUploadsRoot(), "vehicles", tid);
  const abs = path.resolve(root, file);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export async function storeVehiclePhoto(tenantId: string, input: Buffer): Promise<{ url: string; width: number; height: number }> {
  if (!SAFE_SEGMENT.test(tenantId)) {
    throw new PhotoUploadError("Identifiant de tenant invalide.", "INVALID_TENANT", 400);
  }
  if (input.length === 0) throw new PhotoUploadError("Fichier vide.", "EMPTY_FILE");
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new PhotoUploadError("Fichier trop volumineux (8 Mo maximum).", "FILE_TOO_LARGE", 413);
  }

  let pipeline: Sharp;
  let format: string | undefined;
  try {
    pipeline = sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    format = (await pipeline.metadata()).format;
  } catch {
    throw new PhotoUploadError("Ce fichier n'est pas une image valide (JPEG, PNG ou WebP).", "INVALID_IMAGE", 415);
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw new PhotoUploadError("Format non autorisé : JPEG, PNG ou WebP uniquement.", "UNSUPPORTED_FORMAT", 415);
  }

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await pipeline
      .rotate()
      .resize({ width: MAX_PHOTO_EDGE_PX, height: MAX_PHOTO_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoUploadError("Image illisible ou trop grande.", "INVALID_IMAGE", 415);
  }

  const dir = path.join(getUploadsRoot(), "vehicles", tenantId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.webp`;
  await writeFile(path.join(dir, fileName), out.data, { flag: "wx" });
  return { url: vehiclePhotoPublicUrl(tenantId, fileName), width: out.info.width, height: out.info.height };
}

export async function deleteStoredPhoto(tenantId: string, url: string): Promise<void> {
  const abs = resolveOwnedPhotoFile(tenantId, url);
  if (!abs) return; // ancien chemin statique (/images/...) ou URL externe : jamais supprimé
  try {
    await unlink(abs);
  } catch {
    /* déjà absent */
  }
}
