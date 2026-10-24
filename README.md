# vtc-core-api

API HTTP **multi-locataire** pour centraliser la logique métier des sites VTC (tarification, distances, devis, réservations, contacts, envoi d’e-mails). Les frontends appellent cette API ; **aucune page web** n’est servie ici.

## Prérequis

- Node.js 20+
- PostgreSQL (Prisma)
- Variables d’environnement : créer un fichier `.env` à la racine (voir ci-dessous).

## Variables d’environnement

Ne jamais committer le `.env`. En production, définir des secrets forts (les valeurs par défaut `dev-*-change-me` sont réservées au développement).

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `DATABASE_URL` | oui | Connexion PostgreSQL (Prisma) |
| `NODE_ENV` | non | `development` (défaut) ou `production` ; les routes de debug ne répondent qu’en `development` |
| `PORT` | non | Port HTTP (défaut `4000`) |
| `CORS_ORIGINS` | non | Origines autorisées, séparées par des virgules (vide = toutes en dev) |
| `DEFAULT_TENANT_ID` | non | Locataire utilisé sans en-tête `X-Tenant-ID` (défaut `default`) |
| `DISTANCE_MATRIX_API_KEY` | pour `/api/calculer-tarif` | Clé DistanceMatrix.ai |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | oui en prod | Secrets des jetons opérateur |
| `JWT_ACCESS_TTL_SEC` / `JWT_REFRESH_TTL_SEC` | non | Durées de vie des jetons (défaut 900 s / 14 jours) |
| `DASHBOARD_BASE_URL` | non | URL du tableau de bord opérateur, utilisée dans les e-mails |
| `PUBLIC_SITE_URL` | non | URL publique du site, utilisée dans les e-mails |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | pour l’envoi d’e-mails | Serveur SMTP |
| `SMTP_SECURE` / `SMTP_TLS_REJECT_UNAUTHORIZED` | non | Options TLS |
| `MAIL_FROM` / `MAIL_REPLY_TO` / `MAIL_TO_COPY` | non | Expéditeur, réponse, copie des e-mails |
| `STRIPE_SECRET_KEY` | pour les paiements | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | pour les paiements | Secret de signature du webhook Stripe |
| `STRIPE_CONNECT_RETURN_URL` / `STRIPE_CONNECT_REFRESH_URL` | non | Retours de l’onboarding Stripe Connect |
| `STRIPE_PAYMENT_SUCCESS_URL` / `STRIPE_PAYMENT_CANCEL_URL` | non | Retours du paiement |
| `PLATFORM_ADMIN_ENABLED` | non | Active le super-admin plateforme (défaut `false`) |
| `PLATFORM_SESSION_SECRET` | si super-admin | Secret de session du super-admin |
| `TELEMETRY_ENABLED` | non | Active la télémétrie plateforme (défaut `false`) |
| `PRICING_DEBUG_SECRET` | non | Secret d’accès au debug de tarification |
| `SEED_OPERATOR_TENANT_ID` / `SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_PASSWORD` | non | Création de l’opérateur initial au démarrage |

Les scripts d’exploitation (`src/scripts/`) lisent en plus `RESTORE_*`, `REPAIR_*`, `ENSURE_OPERATOR_MODE` et `TEST_EMAIL_TO`.

## Démarrage

```bash
npm install
npm run dev
```

Build production :

```bash
npm run build
npm start
```

## Architecture

| Dossier | Rôle |
|--------|------|
| `src/config` | Chargement de l’environnement (`env.ts`), registre des locataires (`config/tenants/`) |
| `src/routes` | Déclaration des chemins HTTP (un fichier par domaine) |
| `src/controllers` | Entrée HTTP : validation minimale, réponses |
| `src/services` | Orchestration future entre modules (devis, réservation, contact…) |
| `src/modules` | Domaines métier : **pricing** (calculateur, créneaux) et **distance** (Distance Matrix) ; leads / email encore squelettes |
| `src/config/tenants/clients` | Un JSON par site (`id`, `engineRef`, `baseAddress`, `serviceArea`, `smtp`, …) |
| `src/config/tenants/engines` | Moteurs `*.engine.json` (grilles TA/TC, MAD, jours fériés, buffers aéroports, `primaryServiceZoneSetId`) |
| `src/config/tenants/engineLoader.ts` | Association `engineRef` → fichier JSON ; **dépôt opérationnel** = `baseAddress.label` |
| `src/config/tenants/engineSchema.ts` | Validation Zod des moteurs |
| `src/modules/pricing/zoneSets` | Registre des jeux de communes (ex. `fr-76`) pour la zone préférentielle |
| `src/middleware` | Locataire (`X-Tenant-ID`), gestion d’erreur |
| `src/validation` | Schémas Zod et parseurs réutilisables |
| `src/utils` | Réponses JSON homogènes |

### Locataires (multi-client)

- **Client** : `clients/<tenantId>.json` — société, **adresse de base** (obligatoire pour les distances), zone d’intervention (texte), liste aéroports « vitrine », **e-mail** (`smtp`), branding.
- **Moteur** : `engines/<ref>.engine.json` — fuseau, jours fériés, `airports` (matching tarifaire), grilles `taTable` / `tcTable`, `maj`, MAD, multiplicateur hors zone, `primaryServiceZoneSetId` (ex. `fr-76`).
- Le champ **`engineRef`** du client pointe vers un fichier moteur. **Plusieurs sites peuvent partager le même moteur** avec des bases différentes : le dépôt utilisé par l’API est toujours **`baseAddress.label`**.
- Enregistrement des clients dans `registry.ts` (imports explicites). Nouveau moteur : ajouter `engines/nouveau.engine.json` + l’importer dans `engineLoader.ts`.
- Identification des appels par en-tête **`X-Tenant-ID`** (= `id` du client). Si absent, `DEFAULT_TENANT_ID` du `.env` est utilisé.
- `GET /api/health` **ne nécessite pas** de locataire.

### Endpoints

| Méthode | Chemin | Comportement |
|--------|--------|----------------|
| `GET` | `/api/health` | OK — statut, uptime, horodatage |
| `POST` | `/api/calculer-tarif` | **Calcul réel** — Distance Matrix + tarif + créneaux (nécessite `DISTANCE_MATRIX_API_KEY`) |
| `POST` | `/api/devis` | `501` `NOT_IMPLEMENTED` |
| `POST` | `/api/reservation` | idem |
| `POST` | `/api/contact` | idem |

**Calcul tarif** : le corps doit reprendre la forme attendue par le template (`general.TypeService`, blocs `trajetClassique` / `transfertAeroport` / `madEvenementiel` selon le cas). Réponse `200` : `{ success: true, data: { tarif, distances, tarifs, majorations, creneauGlobal, … } }`.

Les autres routes POST valident encore un **objet JSON** libre jusqu’à migration.

### Format d’erreur / non implémenté

Réponses d’échec typées (`success: false`, `error.code`, etc.). Les fonctionnalités non migrées renvoient **HTTP 501** avec `error.code: "NOT_IMPLEMENTED"`.

## Prochaines étapes de migration (référence `vtc-template-front`)

1. **Devis / réservation** : réutiliser `PricingService` / `calculerDistances` + `calculerTarif` dans `QuoteService` et `ReservationService`, puis leads + e-mails.
2. **Leads & e-mails** : migrer `buildLeadRecord`, `sendLeadEmails`, `smtp`, `formatLeadEmail` vers `modules/leads` et `modules/email`.
3. **Chargement dynamique** : aujourd’hui les clients et moteurs sont importés statiquement ; pour la prod, on pourra charger une liste depuis le disque ou une base sans dupliquer le code métier.

Le dossier **`/docs`** du dépôt (audit, inventaire) n’était pas présent dans ce workspace au moment du scaffold : à relire dès qu’il est disponible pour affiner les priorités.

## Hypothèses

- CORS : si `CORS_ORIGINS` est vide, toutes les origines sont acceptées en développement (comportement `cors` avec `origin: true`) ; en production, renseigner explicitement les domaines des sites clients.
- Aucune base de données dans cette phase : persistance et idempotence à ajouter plus tard si besoin.
