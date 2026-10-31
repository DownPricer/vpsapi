# Rapport QA adversarial — SaaS réservation VTC

**Date :** 30/10/2026  
**Périmètre :** `vtc-core-api` + `vtc-template-front/vtc76/vtc76`  
**Règle (audit initial) :** aucun fichier de code modifié ; seul ce rapport créé.  
**Correctifs API (branche `fix/qa-securite`, worktree `vtc-core-api-qa`) :** voir §7 — cases cochées = corrigé côté API ; constats d’origine conservés.  
**Environnement observé :** `DATABASE_URL` → `localhost:5432` (**safe**). Aucune clé `STRIPE_SECRET_KEY` dans `.env`. SMTP configuré vers `smtp.mail.ovh.net` (**réel**) — **aucun envoi réel** : `verify:emails` / previews HTML uniquement ; pour l’intégration, SMTP forcé mentalement hors-scope (suite skippée). Postgres **non démarré** ; Docker Desktop **indisponible**.

---

## 1. Résumé (verdict vente)

**Ne pas vendre en l’état à un client payant sans correctifs bloquants.**  
Le cœur tarifaire (verify scripts) et les unitaires remboursements/Stripe mockés sont solides, mais : (1) un pro peut sauver / faire calculer un **prix à 0 €**, (2) les secrets JWT locaux tombent sur des **valeurs hardcodées**, (3) l’annulation peut **clôturer la course alors que le remboursement Stripe est incertain**, (4) **pas de rate-limit** login/contact/devis, (5) flotte / isolation / Stripe E2E **non rejoués** faute de Postgres + clé Stripe test.  
**Verdict :** *go technique partiel (moteur + unitaires), no-go commercial* tant que les KO bloquants et l’étape intégration ne sont pas verts.

| Gravité | Nombre |
| --- | ---: |
| Bloquant la vente | 5 |
| Majeur | 9 |
| Mineur | 10 |
| Non testable (infra) | nombreux (voir §4) |

---

## 2. Tableau des tests

| Étape | Cas | Résultat | Preuve |
| --- | --- | --- | --- |
| 0 | `npm test` | **OK** | 105/105 pass (~4,7 s) |
| 0 | `npm run test:integration` | **Non testable** | Suites `describe.skip` : pas de `TEST_DATABASE_URL` ; Postgres `localhost:5432` down |
| 0 | `verify:pricing-config` | **OK** | 19/19 cas OK |
| 0 | `verify:pricing-config-mapping` | **OK** | exit 0 |
| 0 | `verify:pricing-config-roundtrip` | **OK** | exit 0 |
| 0 | `verify:classic-base-segments` | **OK** | rejeu déterministe OK |
| 0 | `verify:tenant-vs-pricing-config` | **OK** | 6/6 IDENTIQUE |
| 0 | `verify:emails` | **OK** | 10 templates OK, HTML dans `email-verify-output/` (pas d’envoi SMTP) |
| 0 | `audit:utf8` | **KO partiel** | Scan fichiers : 0 occurrence suspecte ; **échec Prisma** (DB injoignable) → exit 1 |
| 1 | AS / AR / MAD / aéroport (distances figées, config audit) | **OK** | AS 20 km→300 € (min) ; AS 200 km→460 € ; MAD 1 h→200 / 3 h→240 ; ORY→720 ; Paris ×1→930 / ×1.5→1395 |
| 1 | Remise A/R longue | **OK** | 464 € (0 %) vs 441 € (5 %), delta 23 |
| 1 | Nuit / soir / dimanche / férié (trajet > min) | **OK** | 460 / 506 / 552 / 552 / 575 € |
| 1 | Monotonie km croissants | **OK** | 0…500 km : jamais décroissant (plancher 300 puis hausse) |
| 1 | Déterminisme même entrée | **OK** | deux appels → même tarif |
| 1 | Validation négatif / NaN / null / string / énorme / 600 fériés / clés interdites | **OK** | rejet Zod / clés interdites |
| 1 | Remise 100 % + grilles à 0 | **KO** → **corrigé API** ✅ | `VALIDATE_OK` ; MAD/AR → **0 €** ; AS → 4 € (supplément hardcodé) — *voir LOT 2* |
| 1 | Supplément trajet hardcodé 0,2/0,1 €/km | **KO** → **corrigé API** ✅ | `calculator.ts:414-417` hors payload — *branché `supplementShortDistance`, défauts historiques* |
| 1 | Parité API vs front `calculerTarif` | **KO (dette)** | UI passe par l’API ; fork front diverge (hors-zone, A/R %, retour dépôt, véhicule) |
| 1 | Save pro settings vs Zod pricing | **KO** → **corrigé API** ✅ | save ne rejoue pas `validatePricingConfigPayload` — *LOT 2c* |
| 1 | HMAC S2S `pricingConfig` | **KO / non testable runtime** | spec le demande ; non implémenté |
| 2 | Transitions demande / e-mails cycle | **Non testable** | API+DB+SMTP capturés absents ; unitaires e-mail annulation **OK** (échappement HTML) |
| 2 | Doublons / champs / accents | **Partiel** | `audit:utf8` fichiers OK ; scénarios HTTP non joués |
| 3 | Checklist Stripe Connect E2E | **Non testable** | pas de `STRIPE_SECRET_KEY` ; unitaires Connect/refund/webhook mock **OK** (105 tests) |
| 4 | Snapshot politique / jetons / remboursements | **Partiel** | unitaires + doc ; intégration DB skip |
| 4 | Annulation si `STRIPE_UNCERTAIN` | **KO** → **corrigé API** ✅ | annulation poursuivie quand même — *LOT 3b* |
| 4 | `PATCH …/status` → `cancelled` | **KO** → **corrigé API** ✅ | bypass fenêtre cancel/refund — *LOT 3a* |
| 5 | Double booking / DST / archive | **Non testable** | cas écrits dans `fleet.integration.test.ts` mais skip |
| 6 | Isolation 2 tenants HTTP | **Non testable** (DB) ; revue code **OK partiel** | IDOR pro filtré par JWT+tenant ; spoof `X-Tenant-ID` sur public |
| 6 | Sanitize settings publics | **KO** → **corrigé API** ✅ | typo clé e-mail interne — *LOT 4a* |
| 6 | Rate-limit contact/devis/login | **KO** → **corrigé API + revue spoof** ✅ | LOT 4b puis **P1/P2** : login = `req.ip` + plafond e-mail ; publics = `BFF_SHARED_SECRET` + `PUBLIC_RATE_LIMIT` |
| 7 | Auth brute-force / rôles / JWT | **KO** → **JWT + rate-limit login corrigés** ✅ | pas de RBAC admin/agent (analyse seule) ; JWT défaut si env absente |
| 8 | Injection / XSS e-mails | **OK** (unitaire) | échappement HTML motifs ; SQL non rejoué live |
| 9 | Parcours navigateur Playwright | **Non testable** | pas d’API/front/DB/Stripe test locaux up |

---

## 3. Détail des KO

### KO-B1 — Prix 0 € (ou quasi) possible après config « valide » ✅ corrigé (LOT 2)

- **Gravité :** bloquant la vente  
- **Repro :** construire un `pricingConfig` v1 avec `pricePerKm/minimumPrice/hourlyRate/minimumTotal = 0`, remise A/R `100 %` ; `validatePricingConfigPayload` → OK ; `calculerTarif` MAD/AR → **0 €** ; AS → **4 €** (voir KO-B2).  
- **Attendu :** refus de sauvegarde / calcul si le tarif métier peut être ≤ 0.  
- **Obtenu (audit) :** accepté.  
- **Fichier:ligne :** `validatePricingConfigPayload.ts:22` (`finiteNonNegative.min(0)`) ; `calculator.ts:383-388`, `:522-535`.  
- **Correctif :** plancher métier strict (`> 0`) sur grilles utiles + rejet si total calculé `< seuil` ; UI + API save alignés.  
- **Statut fix/qa-securite :** validation + `PricingCalculationError` si total ≤ 0 ; configs `default` / `client-demo` OK.

### KO-B2 — Supplément €/km hardcodé hors payload (0,2 / 0,1) ✅ corrigé (LOT 2d)

- **Gravité :** bloquant (argent / non pilotable)  
- **Repro :** même config à 0 €/km, trajet 20 km → `trajet = 20 × 0.2 = 4`.  
- **Attendu :** tout €/km dans `pricingConfig` (spec payload-driven).  
- **Obtenu (audit) :** constante dans le moteur API **et** front.  
- **Fichier:ligne :** `vtc-core-api/.../calculator.ts:414-417` ; `vtc-template-front/.../calculator.ts:345-348`.  
- **Correctif :** déplacer dans `classicTrip.supplementShortDistance` (déjà dans le schéma Zod mais **non branché** au calcul) ; supprimer le hardcode.  
- **Statut fix/qa-securite :** branché avec défauts exacts 0,2 / 0,1 si champ absent ; non-régression distances.

### KO-B3 — Secrets JWT absents → secrets de développement ✅ corrigé (LOT 1)

- **Gravité :** bloquant la vente (si prod/staging similaire)  
- **Repro :** `.env` local sans `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` → fallback `dev-access-secret-change-me` / `dev-refresh-secret-change-me`.  
- **Attendu :** refus de démarrer hors dev si secrets absents.  
- **Obtenu (audit) :** démarrage possible avec secrets publics.  
- **Fichier:ligne :** `config/env.ts:55-56`.  
- **Correctif :** `required()` en non-dev ; rotation immédiate si déjà déployé ainsi.  
- **Statut fix/qa-securite :** hors `NODE_ENV=development`, refuse secrets absents / défauts / identiques / < 32 car. **Attention :** tant que la prod reste en `NODE_ENV=development`, cette règle **ne protège pas**.

### KO-B4 — Annulation malgré remboursement Stripe incertain ✅ corrigé (LOT 3b)

- **Gravité :** bloquant (course annulée, argent non garanti)  
- **Repro :** `cancelBooking` avec paiement ; `requestRefund` lève `STRIPE_UNCERTAIN` → catch met `refundUncertain=true` puis enchaîne `LeadStatus.cancelled`.  
- **Attendu :** comme refus Stripe : **ne pas** annuler ; retry avec même `clientRequestId`.  
- **Obtenu (audit) :** réservation annulée + flag uncertain.  
- **Fichier:ligne :** `bookingCancellation.service.ts:205-251`.  
- **Correctif :** `throw` / return erreur sur `STRIPE_UNCERTAIN` avant le transaction d’annulation.  
- **Statut fix/qa-securite :** `REFUND_UNCERTAIN` (502) ; `refundUncertain` toujours `false` en succès.

### KO-B5 — `PATCH` statut `cancelled` sans parcours remboursement ✅ corrigé (LOT 3a)

- **Gravité :** bloquant (perte d’encaissement / incohérence paiement)  
- **Repro :** `PATCH /api/requests/:id/status` → `cancelled` (hors `POST …/cancel`).  
- **Attendu :** interdit ; forcer la fenêtre d’annulation.  
- **Obtenu (audit) :** chemin historique encore ouvert (confirmé revue + doc Stripe).  
- **Fichier:ligne :** `requests.controller.ts` / `request.service.ts` (transitions status).  
- **Correctif :** retirer `cancelled` de ce PATCH ; tests d’intégration dédiés.  
- **Statut fix/qa-securite :** `cancelled` + `cancellation_requested` refusés (`STATUS_VIA_CANCEL_FLOW`). Front `demandes/[id]/page.tsx` ouvre déjà `CancelBookingDialog` (ne PATCHait pas `cancelled`).

### KO-M1 — Save réglages pro sans validation Zod pricing ✅ corrigé (LOT 2c)

- **Gravité :** majeur  
- **Repro :** `PUT /api/pro/settings` avec `pricing.classicTrip…pricePerKm: -5` (ou NaN→null JSON) : contrôles taille/clés seulement.  
- **Attendu :** même rigorisme que `validatePricingConfigPayload`.  
- **Obtenu (audit) :** persistance possible de configs toxiques ; le calcul pourra échouer plus tard ou tomber sur fallbacks.  
- **Fichier:ligne :** `tenantSettingsPayload.ts` / `proSettings.controller.ts` (revue).  
- **Correctif :** à la save, `buildPricingConfig` + `validatePricingConfigPayload`.

### KO-M2 — Fork calculateur front ≠ API (dette active) — analyse seule

- **Gravité :** majeur (bloquant si réutilisé)  
- **Constat :** UI tarif → API (`/api/calculer-tarif` proxy). Le fichier front local diverge : hors-zone (départ seul vs départ/arrivée), remise A/R figée 5 %, pas de `returnToBaseEnabled`, pas de supplément véhicule, matching communes naïf.  
- **Fichier:ligne :** front `lib/pricing/calculator.ts` vs API `modules/pricing/calculator.ts`.  
- **Correctif :** supprimer ou générer depuis le même module ; tests de parité CI.

### KO-M3 — Pas de rate-limit login / contact / devis / réservation / calculer-tarif ✅ corrigé (LOT 4b, BFF partiel)

- **Gravité :** majeur  
- **Repro :** spam `POST /api/auth/login`, `/contact`, `/devis`, `/reservation`.  
- **Attendu :** 429 + Retry-After.  
- **Obtenu (audit) :** seuls `booking-view` / `booking-cancel` limités (`public.routes.ts:14-15`).  
- **Correctif :** limiteurs + `trust proxy` derrière reverse-proxy.  
- **Statut fix/qa-securite :** login IP+e-mail actif ; contact/devis/réservation/calculer-tarif limités **uniquement** si `X-Client-Ip` (front BFF à brancher).

### KO-M4 — Pas de RBAC admin vs agent — analyse seule

- **Gravité :** majeur  
- **Repro :** JWT `agent` → refunds, settings, Stripe login-link.  
- **Attendu :** droits restreints.  
- **Obtenu :** `requireAuth` seul.  
- **Correctif :** `requireRole('admin')` sur mutations sensibles.

### KO-M5 — Fuite possible e-mail interne (typo sanitize) ✅ corrigé (LOT 4a)

- **Gravité :** majeur  
- **Repro :** settings contenant `operatorExtraRecipientEmail` → clé lower `operatorextrarecipientemail` **non** dans le set (typo `operatorextracipientemail`).  
- **Attendu :** strip.  
- **Obtenu (audit) :** clé absente de la liste → fuite possible sur `GET /api/public/tenant-settings`.  
- **Fichier:ligne :** `sanitizePublicTenantSettings.ts:24-25`.  
- **Correctif :** corriger l’orthographe + test unitaire sur la clé réelle.

### KO-M6 — Spoof `X-Tenant-ID` / `X-Site-Domain` (surface publique) — analyse seule

- **Gravité :** majeur  
- **Repro :** sans domaine client actif, header tenant → settings publics d’un autre tenant (sanitizés) ; login ciblé.  
- **Attendu :** résolution strictement par Host/Origin allowlist.  
- **Obtenu :** header accepté dans plusieurs chemins (`domainResolver` / middleware tenant).  
- **Correctif :** ignorer `X-Tenant-ID` hors S2S authentifié.

### KO-M7 — CORS `origin: true` si `CORS_ORIGINS` vide (+ cookie refresh `SameSite=None`)

- **Gravité :** majeur (bloquant si déployé sans liste)  
- **Note locale :** `CORS_ORIGINS` est **renseigné** (1 origine) → chemin dangereux non actif ici.  
- **Fichier:ligne :** `app.ts:26-40` ; `auth.controller.ts` cookie refresh.  
- **Correctif :** refuser démarrage prod si liste vide ; `SameSite=Lax` si same-site possible.

### KO-M8 — `pricingConfig` injectable côté API centrale (pas de HMAC S2S)

- **Gravité :** majeur  
- **Repro :** appel direct API avec `pricingConfig` forgé (Next le strippe, l’API l’accepte si présent).  
- **Attendu :** signature S2S (spec §HMAC).  
- **Correctif :** HMAC + allowlist callers ; ou ignorer le payload sauf canal authentifié.

### KO-M9 — Multiplicateur hors-zone / maj manuelle négative ✅ corrigé (LOT 2a)

- **Gravité :** majeur / mineur selon vecteur  
- **Constat :** Zod autorise multiplicateur `≥ 0` (donc 0) ; `readManualMaj` accepte tout `Number` fini (y compris négatif) jusqu’au plancher zone.  
- **Fichier:ligne :** `validatePricingConfigPayload` outOfZone ; `calculator.ts` `readManualMaj`.  
- **Correctif :** `outOfZone.value ≥ 1` ; maj manuelle `≥ 0`.

### KO-m1 — `audit:utf8` exit 1 faute de DB

- **Gravité :** mineur (tooling)  
- **Preuve :** scan fichiers OK ; `prisma.tenant.findMany` échoue.

### KO-m2 — Refresh token : pas de kill-family si réutilisation

- **Gravité :** mineur / majeur selon menace  
- **Correctif :** révoquer toute la chaîne au reuse détecté.

### KO-m3 — Refresh mauvais tenant révoque la session (DoS)

- **Gravité :** mineur  
- **Fichier:ligne :** `auth.controller.ts` refresh avant check tenant.

### KO-m4 — Champs payload (`cityRules`, `options`, …) validés mais non appliqués au calcul

- **Gravité :** mineur (faux sentiment de couverture)  
- **Doc :** `PRICING_PAYLOAD_DRIVEN_SPEC.md`.

### KO-m5 — Rate-limit booking sans `trust proxy` ✅ partiellement adressé (LOT 4b)

- **Gravité :** mineur  
- **Fichier:ligne :** `middleware/rateLimit.ts`.  
- **Statut :** `app.set('trust proxy', 1)` + résolution IP enrichie.

### KO-m6 — E-mails « paiement échoué / expiré » absents

- **Gravité :** mineur produit  
- **Doc :** `EMAILS_MAP.md`.

### KO-m7 — Archive véhicule : course entre check et archive

- **Gravité :** mineur  
- **Attendu :** compter occupations + archiver atomiquement.  
- **Obtenu :** fenêtre de course possible → occupation sur véhicule déjà archivé.  
- **Fichier:ligne :** `vehicle.service.ts:315-329`.  
- **Correctif :** même transaction / `SELECT FOR UPDATE`.

### KO-m8 — Blocs manuels n’empêchent pas l’archive

- **Gravité :** mineur  
- **Fichier:ligne :** `vehicle.service.ts:316-318` (filtre `leadId` only).  
- **Correctif :** inclure blocs futurs ou les purger à l’archive.

### KO-m9 — Changement de date : pas de recalcul prix

- **Gravité :** mineur (doc flotte §8)  
- **Risque :** montant figé incohérent après déplacement.  
- **Correctif :** recalcul serveur ou verrouillage explicite UI.

### KO-m10 — Jetons booking : nouveaux e-mails sans révoquer les anciens

- **Gravité :** mineur  
- **Fichier:ligne :** `bookingAccess.service.ts:30-40`.  
- **Correctif :** révoquer les jetons actifs de la lead à chaque émission.

---

## 3bis. Compléments revues (déjà intégrés ci-dessus)

Sources : [Parité calculateurs](21260c25-c0b1-49f4-8f87-f596161f82ab), [Isolation / auth](d4097871-c5c2-4321-ac07-1a3ff72327cb), [Payload / annulations / flotte](bdaf96b1-f999-44db-8a15-6a9840a67819).

- UI tarif = API seule ; fork front local = dette (hors-zone, A/R %, retour dépôt, véhicule).  
- IDOR pro classique : non trouvé si JWT valide ; failles autour CORS/JWT/rate-limit/RBAC/sanitize.  
- Flotte : double-booking et DST bien conçus en code/tests ; non rejoués faute de DB.

---

## 4. Non testé (et pourquoi)

| Zone | Pourquoi |
| --- | --- |
| `test:integration` (flotte, double booking, DST, isolation DB, webhooks signature réelle, jetons) | Postgres `localhost:5432` down ; Docker Desktop absent ; pas de `TEST_DATABASE_URL` |
| Seed / 2 tenants HTTP live | Même cause DB |
| Stripe Connect E2E (checklist `stripe-connect-test-checklist.md`) | Pas de `STRIPE_SECRET_KEY` (test) ; pas d’API up |
| Envois e-mail réels + MailHog | SMTP OVH réel → **volontairement non utilisé** ; MailHog/Mailpit non démarrés. Choix : **preview-only** (`verify:emails`, `email-verify-output/`) |
| Distance Matrix live | Non appelé (~0 appel) ; distances injectées |
| Parcours navigateur complet | Dépendances API/DB/Stripe/front absentes |
| Audit UTF-8 contenu DB | DB injoignable |
| Cartes Stripe test `4242…` | Bloqué par absence clé |

**Choix e-mails (rappel) :** aucun message vers de vraies adresses ; validation templates en local sans SMTP OVH.

---

## 5. Points positifs (ne pas jeter avec l’eau du bain)

- **105 unitaires** verts : remboursements (idempotence, commission proportionnelle, isolation tenant, webhooks désordonnés), Connect Express, jetons booking, politique d’annulation versionnée, rate-limit unitaire, e-mails XSS échappés, suppléments véhicule.  
- **Verify pricing** (mapping, roundtrip, segments, parité tenant↔payload) tous verts avec distances figées.  
- Sanitize public prévu ; pipeline devis/calcul Next **injecte** `pricingConfig` serveur et refuse le repli silencieux si Zod API rejette.  
- Intégration flotte/refunds **déjà écrite** (riche) — à rejouer dès qu’un Postgres jetable tourne.

---

## 6. Les 5 problèmes à traiter en premier

1. **Interdire prix ≤ 0 €** (validation save + calcul) et **supprimer le supplément hardcodé 0,2/0,1** au profit du payload. ✅ API  
2. **Exiger des secrets JWT réels** (fail-fast hors dev) et vérifier tous les environnements déployés. ✅ API (inefficace tant que prod = `development`)  
3. **Ne plus annuler** si remboursement `STRIPE_UNCERTAIN` ; **fermer** le `PATCH cancelled` de contournement. ✅ API  
4. **Rate-limit** login + contact/devis/réservation + corriger la typo `sanitizePublicTenantSettings` + restreindre spoof `X-Tenant-ID`. ✅ rate-limit + sanitize ; ❌ spoof header (analyse)  
5. **Allumer Postgres de test** + `TEST_DATABASE_URL` + `sk_test_…` + Mailpit, puis **rejouer `test:integration` et la checklist Stripe** avant toute vente.

---

## 7. Correctifs appliqués (`fix/qa-securite`)

| Lot | Commits (messages) | Tests |
| --- | --- | --- |
| 1 JWT | `Exige des secrets JWT sûrs hors développement.` | `envJwtSecrets.test.ts` |
| 2 Pricing | `Durcit la validation tarifaire et branche le supplément court trajet.` | `pricingQaHardening.test.ts` + verify:* verts |
| 3 Annulation | `Bloque l'annulation via PATCH /status et refuse d'annuler si Stripe est incertain.` | `cancellationQaHardening.test.ts` |
| 4a Sanitize | `Corrige le filtre public de operatorExtraRecipientEmail.` | `sanitizePublicTenantSettings.test.ts` |
| 4b Rate-limit | `Ajoute des limiteurs de débit sans bloquer les sites via le BFF Next.` | extensions `bookingAndPolicy.test.ts` |

`npm test` après lots initiaux : **133** pass (was 105).

---

## 8. Revue post-correctifs (31/10/2026) — P1→P4

### P1 — Contournement rate-limit login ✅
- Login utilise uniquement `req.ip` (`trust proxy = 1`) ; ignore `X-Client-Ip` / `X-Forwarded-For` brut.
- Plafond **par e-mail seul** : 10 / 15 min + plafond IP+e-mail : 20 / 15 min.
- Tests : `loginRateLimit.test.ts`.

### P2 — Limiteurs publics + BFF ✅ (API `fix/qa-securite` + front `fix/qa-front`)
- API : `BFF_SHARED_SECRET` (≥ 32 si défini), `PUBLIC_RATE_LIMIT` = `off` | `trusted` (défaut) | `strict`.
- `X-Client-Ip` cru seulement si `X-BFF-Auth` = secret (timing-safe).
- Front : `CENTRAL_API_BFF_SECRET` (jamais `NEXT_PUBLIC_*`) + `X-Client-Ip` via `x-real-ip` sinon **dernier** hop `X-Forwarded-For`.
- Sans secret côté front : n’envoie rien (compat).

#### Ordre de déploiement (obligatoire)
1. Déployer l’API avec `PUBLIC_RATE_LIMIT=trusted` et `BFF_SHARED_SECRET` défini (≥ 32).
2. Ajouter le **même** secret dans le `.env` de chaque site client (`CENTRAL_API_BFF_SECRET`) puis reconstruire les conteneurs front.
3. Seulement ensuite : passer l’API en `PUBLIC_RATE_LIMIT=strict`.

**Nginx (à vérifier toi-même sur le serveur) :** transmettre `X-Real-IP $remote_addr` vers le BFF Next (et `trust proxy` déjà côté API). Ne pas faire confiance au premier élément de `X-Forwarded-For` côté BFF.

### P3 — `REFUND_UNCERTAIN` conserve `clientRequestId` ✅ (front)
- `shouldPreserveClientRequestId` : `STRIPE_UNCERTAIN` | `STRIPE_UNREACHABLE` | `REFUND_UNCERTAIN`.
- Message FR dans `proRefundsClient.ts`.

### P4 — `verify:stored-settings` ✅ (API, lecture seule)
- Script `npm run verify:stored-settings` — slug / chemin / règle uniquement.
- **Résultat local (31/10) :** 3 fichiers OK (`tenant-marketing-defaults.json`, `clients/default.json`, `clients/client-demo.json`) ; base locale injoignable / sans settings.
- Si une config prod échoue : **migration douce** recommandée — valider `settings.pricing` seulement lorsque le bloc pricing est présent/modifié dans le PUT, ou backfill one-shot des grilles ≤ 0, plutôt que de bloquer tout l’enregistrement des réglages marketing.

### Matrice de transitions (proposition — à valider, non implémentée)

Statuts modèle : `new`, `pending`, `accepted`, `refused`, `processed`, `archived`, `scheduled`, `completed`, `cancelled`, `expired`, `cancellation_requested`.

| Depuis → | Autorisé (PATCH /status) | Interdit (utiliser autre flux) |
| --- | --- | --- |
| `new` / `pending` | `accepted`, `refused`, `processed`, `archived`, `expired` | `cancelled`, `cancellation_requested` → POST cancel / jeton client |
| `accepted` / `scheduled` | `processed`, `completed`, `archived`, `refused` | idem annulation |
| `cancellation_requested` | (aucune via PATCH) | resolve via POST cancellation-request/resolve |
| `completed` / `refused` / `cancelled` / `expired` / `archived` | `archived` seulement (si pas déjà) | retour vers `new`/`pending`/`accepted` |
| `processed` | `archived`, `completed`, `scheduled` | annulation via PATCH |

---

## Variables d’environnement (noms seulement)

| Où | Variable |
| --- | --- |
| API | `BFF_SHARED_SECRET`, `PUBLIC_RATE_LIMIT`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV` |
| Front (serveur) | `CENTRAL_API_BFF_SECRET`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_TENANT_ID` |

---

*Fin du rapport — audit initial sans code ; §7–8 = correctifs API/front ultérieurs.*
