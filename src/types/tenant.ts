import type { TenantPricingEngineConfig } from "../modules/pricing/engineTypes";

/**
 * Schéma de configuration par locataire (client VTC).
 * Les champs sont volontairement génériques pour éviter tout couplage à un site existant.
 */
export interface TenantCoordinates {
  lat: number;
  lng: number;
}

export interface TenantAddress {
  label: string;
  city?: string;
  postalCode?: string;
  country?: string;
  coordinates?: TenantCoordinates;
}

export interface TenantServiceArea {
  description: string;
  /** Identifiants ou libellés de zones couvertes (à affiner selon les besoins métier) */
  regions?: string[];
}

export interface TenantAirport {
  code: string;
  name: string;
  notes?: string;
}

export interface TenantPricingRules {
  /** Emplacement des règles métier (majorations, grilles, etc.) — migration progressive */
  notes?: string;
  /** Référence future vers une stratégie de calcul (ex. grille par type de service) */
  strategyId?: string;
}

export interface TenantSmtpConfig {
  /** Destinataire opérationnel pour les leads / devis */
  toEmail: string;
  fromName?: string;
  /** expéditeur technique si différent du branding */
  fromEmail?: string;
  /**
   * Accusé de réception au client (devis / réservation).
   * Si absent, utilise la variable `MAIL_SEND_CUSTOMER_CONFIRMATION` (défaut : true).
   */
  sendCustomerConfirmation?: boolean;
}

export interface TenantBrandingRefs {
  siteUrl?: string;
  /** Références futures (logo, couleurs) — l’API ne sert pas de fichiers statiques */
  logoUrl?: string;
}

export interface TenantLegal {
  siret?: string;
  tvaIntracom?: string;
  rcs?: string;
}

export interface TenantCompany {
  name: string;
  legalName?: string;
  legal?: TenantLegal;
}

/**
 * Données lues depuis les fichiers JSON (`clients/*.json`).
 * Le moteur de tarif est chargé via `engineRef` → `engines/<ref>.engine.json`.
 */
export type TenantConfigFile = {
  id: string;
  /** Référence vers un fichier `src/config/tenants/engines/<ref>.engine.json` (voir `engineLoader.ts`). */
  engineRef: string;
  company: TenantCompany;
  /**
   * Adresse de dépôt par défaut (`depotAddress` du moteur) si le corps de requête n’envoie pas `vtcBaseAddress`
   * (repli compatibilité — le white-label envoie l’adresse depuis les tenant settings du front).
   */
  baseAddress: TenantAddress;
  /** Zone commerciale / marketing (libellé + régions). La zone tarifaire « préférentielle » est dans le moteur (`primaryServiceZoneSetId`). */
  serviceArea: TenantServiceArea;
  pricing: TenantPricingRules;
  /** Métadonnées affichage / SEO (le matching aéroports pour le prix est dans `pricingEngine.airports`). */
  airports: TenantAirport[];
  smtp: TenantSmtpConfig;
  branding?: TenantBrandingRefs;
};

export interface TenantConfig extends TenantConfigFile {
  /** Règles métier complètes (grilles, zones, jours fériés…) — résolu par locataire. */
  pricingEngine: TenantPricingEngineConfig;
}
