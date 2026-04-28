import { config as loadDotenv } from "dotenv";
import { resolve } from "path";

// Node ne lit pas `.env` tout seul : charger avant `loadEnv()`.
// Racine du package : `src/` → `../.env`, `dist/` → `../.env`.
loadDotenv({ path: resolve(__dirname, "../.env") });

// Important : charger les modules applicatifs après dotenv,
// sinon Prisma peut lire DATABASE_URL trop tôt (avant injection .env).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadEnv } = require("./config/env") as typeof import("./config/env");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createApp } = require("./app") as typeof import("./app");

const env = loadEnv();
const app = createApp();

if (env.distanceMatrixApiKey) {
  console.log("[vtc-core-api] Distance Matrix : clé API chargée depuis .env");
} else {
  console.warn("[vtc-core-api] Distance Matrix : DISTANCE_MATRIX_API_KEY absente — calcul tarif impossible");
}

app.listen(env.port, () => {
  console.log(`[vtc-core-api] Écoute sur le port ${env.port} (${env.nodeEnv})`);
});
