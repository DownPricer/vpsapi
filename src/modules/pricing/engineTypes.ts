/**
 * Configuration moteur de tarification par locataire (données métier, sans branding client).
 */

export type AirportBuffers = Record<
  string,
  { preFlightMin: number; arrivalMin: number; dropoffMarginMin: number }
>;

export type AirportDefinition = { names: string[]; address: string };

export type TaTable = Record<
  string,
  Record<string, Record<string, { tarifKm: number; min: number }>>
>;

export type TcZoneEntry = {
  min: number;
  tarifsKm: Record<string, number>;
};

export type TcTable = {
  SIMPLE: { ZONES: Record<number, TcZoneEntry>; APPROCHE: number };
  AR: { ZONES: Record<number, TcZoneEntry>; APPROCHE: number };
};

export type MajConfig = {
  pctNight: number;
  pctEvening: number;
  pctWE: number;
  pctFerie: number;
  minEuros: number;
};

export type MadHourlyRates = {
  default: number;
  eveningOrNight: number;
  weekendOrHoliday: number;
};

/**
 * Configuration complète injectée dans calculateur, créneaux et utilitaires.
 */
export interface TenantPricingEngineConfig {
  timezone: string;
  /** Point de départ des calculs d’approche / retour base (adresse libre). */
  depotAddress: string;
  publicHolidays: readonly string[];
  airportBuffers: AirportBuffers;
  airports: Record<string, AirportDefinition>;
  taTable: TaTable;
  tcTable: TcTable;
  maj: MajConfig;
  applyArDiscount: boolean;
  /** Pourcentage de remise aller-retour (ex. 5 → total × 0,95). 0 si désactivée. */
  arDiscountPercent: number;
  outOfPrimaryServiceZoneMultiplier: number;
  /** Facturer le segment destination → base (retour dépôt) sur les trajets classiques. */
  returnToBaseEnabled: boolean;
  /**
   * Identifiant de jeu de communes (slugs normalisés) pour la zone « préférentielle ».
   * Ex. `fr-76` — résolu via `zoneSets/registry`.
   */
  primaryServiceZoneSetId: string;
  madHourlyRates: MadHourlyRates;
  madEventMinimumTotal: number;
  calendarEventTitlePrefix: string;
}
