function required(name: string, value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

function optionalInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Variable d'environnement invalide (nombre attendu) : ${name}`);
  }
  return n;
}

function optionalBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

/** Valeurs de repli locales uniquement — jamais utilisables hors développement. */
export const DEV_JWT_ACCESS_SECRET = "dev-access-secret-change-me";
export const DEV_JWT_REFRESH_SECRET = "dev-refresh-secret-change-me";

const JWT_SECRET_MIN_LENGTH = 32;

export interface AppEnv {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  defaultTenantId: string;
  distanceMatrixApiKey: string | undefined;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  dashboardBaseUrl: string;
  platformAdminEnabled: boolean;
  platformSessionSecret: string;
  telemetryEnabled: boolean;
}

function resolveJwtSecrets(nodeEnv: string): { access: string; refresh: string } {
  const accessRaw = process.env.JWT_ACCESS_SECRET?.trim() || "";
  const refreshRaw = process.env.JWT_REFRESH_SECRET?.trim() || "";
  const isDev = nodeEnv === "development";

  if (isDev) {
    const access = accessRaw || DEV_JWT_ACCESS_SECRET;
    const refresh = refreshRaw || DEV_JWT_REFRESH_SECRET;
    if (!accessRaw || !refreshRaw || access === DEV_JWT_ACCESS_SECRET || refresh === DEV_JWT_REFRESH_SECRET) {
      console.warn(
        "[env] Avertissement : secrets JWT de développement utilisés. Définir JWT_ACCESS_SECRET et JWT_REFRESH_SECRET (≥ 32 caractères, distincts) avant tout déploiement."
      );
    }
    return { access, refresh };
  }

  if (!accessRaw || !refreshRaw) {
    throw new Error(
      "JWT_ACCESS_SECRET et JWT_REFRESH_SECRET sont obligatoires hors développement (valeurs absentes)."
    );
  }
  if (accessRaw === DEV_JWT_ACCESS_SECRET || refreshRaw === DEV_JWT_REFRESH_SECRET) {
    throw new Error(
      "JWT_ACCESS_SECRET / JWT_REFRESH_SECRET ne doivent pas utiliser les valeurs de développement hors développement."
    );
  }
  if (accessRaw === refreshRaw) {
    throw new Error(
      "JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être distincts."
    );
  }
  if (accessRaw.length < JWT_SECRET_MIN_LENGTH || refreshRaw.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent contenir au moins ${JWT_SECRET_MIN_LENGTH} caractères.`
    );
  }
  return { access: accessRaw, refresh: refreshRaw };
}

export function loadEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const corsRaw = process.env.CORS_ORIGINS?.trim();
  const corsOrigins =
    corsRaw && corsRaw.length > 0
      ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const jwt = resolveJwtSecrets(nodeEnv);

  return {
    nodeEnv,
    port: optionalInt("PORT", process.env.PORT, 4000),
    corsOrigins,
    defaultTenantId: process.env.DEFAULT_TENANT_ID?.trim() || "default",
    distanceMatrixApiKey: process.env.DISTANCE_MATRIX_API_KEY?.trim() || undefined,
    jwtAccessSecret: jwt.access,
    jwtRefreshSecret: jwt.refresh,
    accessTokenTtlSec: optionalInt("JWT_ACCESS_TTL_SEC", process.env.JWT_ACCESS_TTL_SEC, 900),
    refreshTokenTtlSec: optionalInt(
      "JWT_REFRESH_TTL_SEC",
      process.env.JWT_REFRESH_TTL_SEC,
      60 * 60 * 24 * 14
    ),
    dashboardBaseUrl: process.env.DASHBOARD_BASE_URL?.trim() || "https://app.sitereadyshd.fr",
    platformAdminEnabled: optionalBool(process.env.PLATFORM_ADMIN_ENABLED, false),
    platformSessionSecret: process.env.PLATFORM_SESSION_SECRET?.trim() || "",
    telemetryEnabled: optionalBool(process.env.TELEMETRY_ENABLED, false),
  };
}

/** Utilisé quand une fonctionnalité exige explicitement la clé (ex. calcul distance). */
export function requireDistanceMatrixKey(): string {
  return required("DISTANCE_MATRIX_API_KEY", process.env.DISTANCE_MATRIX_API_KEY);
}
