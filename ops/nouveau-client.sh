#!/usr/bin/env bash
# Crée un nouveau site VTC client, indépendant, sur le VPS.
#
#   ./nouveau-client.sh --slug dupont-vtc --name "Dupont VTC" \
#                       --domain dupont-vtc.fr --email contact@dupont-vtc.fr
#
# Ce que ça fait :
#   1. crée le tenant en base (réglages vierges, domaine actif, compte pro admin)
#   2. clone le front dans $CLIENTS_DIR/<slug> et l'épingle sur --ref (défaut : $FRONT_REF)
#   3. génère .env + docker-compose.yml, construit l'image et lance le conteneur
#   4. génère la conf Nginx (et le SSL si CERTBOT_CMD est défini)
#
# Options :
#   --legal-name "SAS Dupont VTC"  raison sociale (défaut : --name)
#   --ref v1.0                     branche ou tag du front à déployer
#   --skip-tenant                  le tenant existe déjà en base (reprise après erreur)
#   --skip-nginx                   ne pas toucher à Nginx
#   --dry-run                      valide les paramètres sans rien créer
set -Eeuo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[ -f "$OPS_DIR/ops.env" ] && . "$OPS_DIR/ops.env"

VTC_ROOT="${VTC_ROOT:-/opt/vtc}"
CLIENTS_DIR="${CLIENTS_DIR:-$VTC_ROOT/clients}"
API_CONTAINER="${API_CONTAINER:-vtc-api}"
NGINX_CONTAINER="${NGINX_CONTAINER:-downpricer-nginx}"
NGINX_NETWORK="${NGINX_NETWORK:-vtc_default}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/opt/downpricer/nginx/conf.d}"
NGINX_ACME_DIR="${NGINX_ACME_DIR:-/opt/downpricer/nginx/ssl/acme}"
VPS_IP="${VPS_IP:-51.210.179.212}"
NGINX_SSL_DIR_IN_CONTAINER="${NGINX_SSL_DIR_IN_CONTAINER:-/etc/nginx/ssl}"
NGINX_RELOAD_CMD="${NGINX_RELOAD_CMD:-docker exec $NGINX_CONTAINER nginx -s reload}"
CERTBOT_CMD="${CERTBOT_CMD:-}"
API_PUBLIC_URL="${API_PUBLIC_URL:-https://api.sitereadyshd.fr}"
TEMPLATE_ENV="${TEMPLATE_ENV:-$VTC_ROOT/vtcfront/.env.local}"
FRONT_REPO_URL="${FRONT_REPO_URL:-}"
FRONT_REF="${FRONT_REF:-main}"
CLIENT_MEM_LIMIT="${CLIENT_MEM_LIMIT:-512m}"

SLUG="" NAME="" LEGAL_NAME="" DOMAIN="" EMAIL="" REF="" SKIP_TENANT=0 SKIP_NGINX=0 DRY_RUN=0

trap 'echo "ERREUR inattendue (ligne $LINENO) : $BASH_COMMAND" >&2' ERR
die() { echo "ERREUR : $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --legal-name) LEGAL_NAME="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --ref) REF="${2:-}"; shift 2 ;;
    --skip-tenant) SKIP_TENANT=1; shift ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done

[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$ ]] || die "--slug requis (minuscules, chiffres, tirets ; ex. dupont-vtc)"
[ -n "$NAME" ] || die "--name requis"
[ -n "$DOMAIN" ] || die "--domain requis"
[ -n "$EMAIL" ] || die "--email requis"
[ -n "$LEGAL_NAME" ] || LEGAL_NAME="$NAME"
REF="${REF:-$FRONT_REF}"
# domaine nu : sans schéma, sans www, sans chemin
DOMAIN="$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##; s#^www\.##' | tr 'A-Z' 'a-z')"

CLIENT_DIR="$CLIENTS_DIR/$SLUG"
CONTAINER="vtc-client-$SLUG"

step "Contrôles préalables"
command -v docker >/dev/null || die "docker introuvable"
command -v git >/dev/null || die "git introuvable"
docker compose version >/dev/null 2>&1 || die "docker compose introuvable"
[ "$(docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null)" = "true" ] \
  || die "le conteneur API '$API_CONTAINER' ne tourne pas (variable API_CONTAINER)"
[ ! -e "$CLIENT_DIR" ] || [ "$SKIP_TENANT" = 1 ] || die "$CLIENT_DIR existe déjà"
[ -f "$TEMPLATE_ENV" ] || die "fichier .env modèle introuvable : $TEMPLATE_ENV (variable TEMPLATE_ENV)"

if [ -z "$FRONT_REPO_URL" ]; then
  [ -d "$VTC_ROOT/vtcfront/.git" ] || die "FRONT_REPO_URL non défini et $VTC_ROOT/vtcfront n'est pas un dépôt git"
  FRONT_REPO_URL="$(git -C "$VTC_ROOT/vtcfront" remote get-url origin)"
fi
echo "Front : $FRONT_REPO_URL @ $REF"

docker network inspect "$NGINX_NETWORK" >/dev/null 2>&1 || die "réseau Docker '$NGINX_NETWORK' introuvable (variable NGINX_NETWORK)"
# Nginx doit être sur le même réseau que les conteneurs clients pour les joindre par leur nom.
docker network connect "$NGINX_NETWORK" "$NGINX_CONTAINER" 2>/dev/null || true
echo "Réseau Nginx : $NGINX_NETWORK"

step "Validation du tenant (rien n'est écrit)"
docker exec "$API_CONTAINER" npm run --silent tenant:create -- \
  --slug "$SLUG" --name "$NAME" --legal-name "$LEGAL_NAME" --domain "$DOMAIN" --email "$EMAIL" --dry-run \
  || { [ "$SKIP_TENANT" = 1 ] || die "validation refusée (voir ci-dessus)"; }

if [ "$DRY_RUN" = 1 ]; then
  echo; echo "Dry-run terminé : aucun changement."; exit 0
fi

PASSWORD="(inchangé — tenant déjà créé)"
if [ "$SKIP_TENANT" = 0 ]; then
  step "Création du tenant, du domaine et du compte pro"
  OUT="$(docker exec "$API_CONTAINER" npm run --silent tenant:create -- \
    --slug "$SLUG" --name "$NAME" --legal-name "$LEGAL_NAME" --domain "$DOMAIN" --email "$EMAIL")"
  echo "$OUT" | grep -v '^__RESULT__'
  PASSWORD="$(echo "$OUT" | sed -n 's/^__RESULT__ //p' | sed -E 's/.*"password":"([^"]*)".*/\1/')"
  [ -n "$PASSWORD" ] || die "mot de passe non récupéré — vérifier la base avant de relancer"
fi

step "Clonage du front"
mkdir -p "$CLIENTS_DIR"
if [ ! -d "$CLIENT_DIR/site/.git" ]; then
  mkdir -p "$CLIENT_DIR"
  git clone --branch "$REF" "$FRONT_REPO_URL" "$CLIENT_DIR/site"
fi

step "Configuration du conteneur"
cp "$OPS_DIR/Dockerfile.client" "$CLIENT_DIR/Dockerfile.client"

# .env d'exécution : on part du .env du site modèle (SMTP, etc.), on remplace ce qui est propre au client.
ENV_FILE="$CLIENT_DIR/.env"
grep -Ev '^(NEXT_PUBLIC_TENANT_ID|NEXT_PUBLIC_SITE_URL|NEXT_PUBLIC_API_URL|MAIL_TO|MAIL_TO_COPY|MAIL_REPLY_TO)=' "$TEMPLATE_ENV" > "$ENV_FILE" || true
{
  echo "NEXT_PUBLIC_API_URL=$API_PUBLIC_URL"
  echo "NEXT_PUBLIC_TENANT_ID=$SLUG"
  echo "NEXT_PUBLIC_SITE_URL=https://$DOMAIN"
  echo "MAIL_TO=$EMAIL"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

cat > "$CLIENT_DIR/docker-compose.yml" <<EOF
services:
  front:
    container_name: $CONTAINER
    build:
      context: ./site
      dockerfile: ../Dockerfile.client
      args:
        NEXT_PUBLIC_API_URL: "$API_PUBLIC_URL"
        NEXT_PUBLIC_TENANT_ID: "$SLUG"
        NEXT_PUBLIC_SITE_URL: "https://$DOMAIN"
    env_file: .env
    restart: unless-stopped
    mem_limit: $CLIENT_MEM_LIMIT
    networks: [web]
networks:
  web:
    external: true
    name: $NGINX_NETWORK
EOF

step "Build et démarrage (quelques minutes)"
( cd "$CLIENT_DIR" && docker compose build && docker compose up -d )

echo -n "Attente du site"
OK=0
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:3000/ 2>/dev/null; then OK=1; break; fi
  echo -n "."; sleep 2
done
echo
[ "$OK" = 1 ] || die "le conteneur ne répond pas : docker logs $CONTAINER"

# resolver + variable : si ce conteneur est arrêté, Nginx démarre quand même (un upstream
# introuvable dans un proxy_pass statique ferait échouer nginx -t et pourrait couper TOUS les sites).
PROXY_BLOCK="    location / {
        resolver 127.0.0.11 ipv6=off valid=30s;
        set \$upstream http://$CONTAINER:3000;
        proxy_pass \$upstream;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }"
ACME_BLOCK="    location ^~ /.well-known/acme-challenge/ {
        root /etc/nginx/ssl/acme;
        default_type text/plain;
        try_files \$uri =404;
    }"

# Étape 1 : HTTP seul (le site répond déjà, et Let's Encrypt peut valider le domaine)
CONF_HTTP="server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

$ACME_BLOCK

$PROXY_BLOCK
}"

# Étape 2 : HTTPS, au format des autres sites (redirection 80 -> 443)
CONF_HTTPS="server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

$ACME_BLOCK

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate $NGINX_SSL_DIR_IN_CONTAINER/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key $NGINX_SSL_DIR_IN_CONTAINER/live/$DOMAIN/privkey.pem;

$PROXY_BLOCK
}"

# Écrit un fichier de conf (sudo si le dossier n'est pas accessible en écriture), teste, recharge.
# En cas d'échec du test Nginx, la conf est retirée pour ne pas casser les autres sites.
apply_nginx_conf() {
  local text="$1" target="$NGINX_CONF_DIR/$DOMAIN.conf"
  if [ -w "$NGINX_CONF_DIR" ]; then echo "$text" > "$target"; else echo "$text" | sudo tee "$target" >/dev/null; fi
  if docker exec "$NGINX_CONTAINER" nginx -t >/dev/null 2>&1; then
    eval "$NGINX_RELOAD_CMD" >/dev/null 2>&1
  else
    if [ -w "$NGINX_CONF_DIR" ]; then rm -f "$target"; else sudo rm -f "$target"; fi
    docker exec "$NGINX_CONTAINER" nginx -t 2>&1 | grep -v 'warn' || true
    die "conf Nginx invalide, retirée : $target"
  fi
}

step "Nginx"
if [ "$SKIP_NGINX" = 1 ] || [ -z "$NGINX_CONF_DIR" ]; then
  echo "NGINX_CONF_DIR non défini (ou --skip-nginx) : conf à poser à la main, enregistrée dans $CLIENT_DIR/nginx.conf.txt"
  { echo "# --- Étape 1 : HTTP ---"; echo "$CONF_HTTP"; echo; echo "# --- Étape 2 : HTTPS (après certbot) ---"; echo "$CONF_HTTPS"; } > "$CLIENT_DIR/nginx.conf.txt"
else
  [ -n "$NGINX_ACME_DIR" ] && mkdir -p "$NGINX_ACME_DIR" 2>/dev/null || true
  apply_nginx_conf "$CONF_HTTP"
  echo "Site en HTTP : http://$DOMAIN (si le DNS pointe déjà sur ce VPS)"
  DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')" || DNS_IP=""
  if [ -n "$CERTBOT_CMD" ] && [ "$DNS_IP" != "$VPS_IP" ]; then
    echo "DNS : $DOMAIN pointe sur '${DNS_IP:-rien}' au lieu de $VPS_IP : certificat non demandé."
    echo "Créer l'enregistrement A (sans AAAA) pour $DOMAIN et www.$DOMAIN, attendre la propagation, puis relancer :"
    echo "  ./nouveau-client.sh --slug $SLUG --name \"$NAME\" --domain $DOMAIN --email $EMAIL --skip-tenant"
  elif [ -n "$CERTBOT_CMD" ]; then
    if eval "${CERTBOT_CMD//\{DOMAIN\}/$DOMAIN}"; then
      apply_nginx_conf "$CONF_HTTPS"
      echo "HTTPS actif : https://$DOMAIN"
    else
      echo "SSL non obtenu : le DNS de $DOMAIN et www.$DOMAIN doit pointer sur ce VPS."
      echo "Relancer ensuite :  ./nouveau-client.sh --slug $SLUG --name \"$NAME\" --domain $DOMAIN --email $EMAIL --skip-tenant"
    fi
  else
    echo "CERTBOT_CMD non défini : obtenir le certificat, puis poser l'étape 2 de $CLIENT_DIR/nginx.conf.txt"
  fi
fi

if grep -q 'CORS_ORIGINS=.\+' "$VTC_ROOT/vpsapi/.env" 2>/dev/null; then
  echo
  echo "ATTENTION : l'API restreint CORS_ORIGINS. Ajouter https://$DOMAIN et https://www.$DOMAIN puis redémarrer l'API."
fi

ACCES="$CLIENT_DIR/ACCES.txt"
# Relance avec --skip-tenant : on garde le mot de passe déjà enregistré au lieu de l'écraser.
if [ "$SKIP_TENANT" = 1 ] && [ -f "$ACCES" ]; then
  OLD_PW="$(sed -n 's/^Mot de passe: //p' "$ACCES")"
  case "$OLD_PW" in ""|"("*) ;; *) PASSWORD="$OLD_PW" ;; esac
fi
{
  echo "Client      : $NAME ($SLUG)"
  echo "Site        : https://$DOMAIN"
  echo "Espace pro  : https://$DOMAIN/pro/login"
  echo "Identifiant : $EMAIL"
  echo "Mot de passe: $PASSWORD"
} > "$ACCES"
chmod 600 "$ACCES"

step "Terminé"
cat "$ACCES"
cat <<EOF

À faire ensuite :
  1. DNS : pointer $DOMAIN et www.$DOMAIN vers l'IP du VPS (si ce n'est pas déjà fait)
  2. Se connecter en pro, compléter /pro/site (adresse, téléphone, textes légaux), /pro/tarifs, /pro/vehicules
  3. Le client connecte son Stripe depuis /pro/stripe
  4. Faire une réservation test de bout en bout, puis lui remettre ses accès (fichier $ACCES)
EOF
