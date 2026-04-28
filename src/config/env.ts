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
}

export function loadEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const corsRaw = process.env.CORS_ORIGINS?.trim();
  const corsOrigins =
    corsRaw && corsRaw.length > 0
      ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    nodeEnv,
    port: optionalInt("PORT", process.env.PORT, 4000),
    corsOrigins,
    defaultTenantId: process.env.DEFAULT_TENANT_ID?.trim() || "default",
    distanceMatrixApiKey: process.env.DISTANCE_MATRIX_API_KEY?.trim() || undefined,
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET?.trim() || "dev-access-secret-change-me",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET?.trim() || "dev-refresh-secret-change-me",
    accessTokenTtlSec: optionalInt("JWT_ACCESS_TTL_SEC", process.env.JWT_ACCESS_TTL_SEC, 900),
    refreshTokenTtlSec: optionalInt(
      "JWT_REFRESH_TTL_SEC",
      process.env.JWT_REFRESH_TTL_SEC,
      60 * 60 * 24 * 14
    ),
    dashboardBaseUrl: process.env.DASHBOARD_BASE_URL?.trim() || "https://app.sitereadyshd.fr",
  };
}

/** Utilisé quand une fonctionnalité exige explicitement la clé (ex. calcul distance). */
export function requireDistanceMatrixKey(): string {
  return required("DISTANCE_MATRIX_API_KEY", process.env.DISTANCE_MATRIX_API_KEY);
}
