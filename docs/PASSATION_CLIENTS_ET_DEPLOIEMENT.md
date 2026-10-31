# VTC — clients et déploiement (état au 26/10/2026)

Lire d'abord ce fichier, puis `Dossier_passation_projet_VTC_25-10-2026.pdf` pour le détail du produit. Aucun secret ici.

## Principe
- **Une API partagée** (multi-tenant) + **un conteneur front par client**, tous construits depuis le même dépôt.
- Un client = un *tenant* en base (réglages, tarifs, véhicules, comptes) + un domaine + un conteneur `vtc-client-<slug>`.
- Les réglages d'un client sont en **base de données** : un déploiement ne les écrase jamais.

## Dépôts et branches (vérifier `git remote -v` avant tout commit : le dossier parent pointe vers un autre dépôt, `anthea`)
| Quoi | Dossier local | Dépôt | Branche déployée |
|---|---|---|---|
| API | `VTC/vtc-core-api` | `DownPricer/vpsapi` | **`feat/admin-cockpit-redesign`** (pas `main`) |
| Front | `VTC/vtc-template-front/vtc76/vtc76` | `DownPricer/vtc` | `main` |
| Scripts clients | `VTC/ops` | **aucun dépôt** (copie sur le VPS : `/opt/vtc/ops`) | — |

Des modifications locales de l'API ne sont **pas committées** (auth, distance, encodage) : ne pas les écraser.

## VPS (`51.210.179.212`, SSH `ubuntu`)
- Compose VTC : `/opt/vtc` (`vtc-api`, `vtc-front`, `vtc-postgres`). Code monté en volume, build au démarrage (~1 min de 502 à chaque recréation).
- Clients : `/opt/vtc/clients/<slug>/` (site, `.env`, `docker-compose.yml`, `ACCES.txt`).
- Nginx central `downpricer-nginx` : confs `/opt/downpricer/nginx/conf.d`, certificats `/opt/downpricer/nginx/ssl`. Le VPS héberge d'autres sites (anthea, marant-jonathan, downpricer…) : ne jamais toucher à leurs confs sans `nginx -t`.
- Certificats : renouvelés par Certbot en `webroot` (`/opt/downpricer/nginx/ssl/acme`) + hook de copie ; ne pas repasser en `standalone`.

## Créer un client
```bash
cd /opt/vtc/ops && ./nouveau-client.sh --slug dupont-vtc --name "Dupont VTC" \
  --domain dupont-vtc.fr --email contact@dupont-vtc.fr      # --dry-run pour tester
```
Avant : DNS `A` (sans `AAAA`) vers l'IP du VPS pour le domaine **et** `www`. Le script crée le tenant, le conteneur, la conf Nginx et le SSL ; accès dans `ACCES.txt`. Si le DNS n'est pas prêt, relancer avec `--skip-tenant`.

## Déployer (toujours avec l'accord du propriétaire : coupure ~1 min pour l'API)
- **API** (corrige tous les clients) : `cd /opt/vtc/vpsapi && git pull --ff-only origin feat/admin-cockpit-redesign && cd /opt/vtc && docker compose up -d --force-recreate api`
- **Clients** : `/opt/vtc/ops/maj-clients.sh [slug] [--ref <tag>]` (un par un ; ignore un client avec modifications locales).
- **Site modèle** : `cd /opt/vtc/vtcfront && git pull --ff-only origin main && cd /opt/vtc && docker compose up -d --force-recreate front`
- Migrations Prisma : lancées automatiquement au démarrage de l'API → sauvegarde Postgres avant toute migration destructive.

## Pièges connus
- Un tenant créé par `tenant:create` n'a pas de fichier de config : son identité (nom, e-mail de destination, URL) est construite depuis la base (`src/tenancy/tenantRuntimeConfig.ts`). Ne pas réintroduire `getTenantConfig()` seul pour un tenant quelconque.
- Les URLs Stripe d'`.env` donnent le **chemin** ; l'origine vient du domaine actif du tenant.
- CORS : tout domaine **actif** d'un tenant est autorisé automatiquement.
- `NEXT_PUBLIC_*` sont figées au build du front : changer le tenant ou l'URL d'API impose un rebuild.
- Les e-mails de demande vont à l'e-mail public des réglages, sinon au compte admin ; une adresse `@example.*` est ignorée.

## Règles
Jamais de secret dans un message ou un commit · pas de `docker compose down -v` ni `docker system prune` · tester `nginx -t` avant tout reload · tests API : `npx tsx --test src/tests/*.test.ts`.

## Reste à faire
Mettre `ops/` dans un dépôt Git · recette Stripe en clés TEST · committer les modifications locales de l'API · (fait le 31/10) l'API tourne en `NODE_ENV=production` : le `.env` doit garder `NPM_CONFIG_INCLUDE=dev`, sinon `npm install` saute `typescript`/`tsx` et l'API redémarre en boucle · le client `exemple` est un tenant de test (e-mail `contact@exemple.sitereadyshd.fr` sans vraie boîte).
