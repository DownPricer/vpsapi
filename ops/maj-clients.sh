#!/usr/bin/env bash
# Met à jour les sites clients : git fetch + checkout de la version voulue + rebuild + restart.
#
#   ./maj-clients.sh                 tous les clients, version $FRONT_REF
#   ./maj-clients.sh --ref v1.1      tous les clients, tag/branche v1.1
#   ./maj-clients.sh dupont-vtc      un seul client
#   ./maj-clients.sh --list          liste les clients et leur version
#
# Un client dont le dépôt local a des modifications non committées est ignoré (jamais écrasé).
set -Eeuo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[ -f "$OPS_DIR/ops.env" ] && . "$OPS_DIR/ops.env"

VTC_ROOT="${VTC_ROOT:-/opt/vtc}"
CLIENTS_DIR="${CLIENTS_DIR:-$VTC_ROOT/clients}"
REF="${FRONT_REF:-main}"
ONLY=""
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "option inconnue : $1" >&2; exit 1 ;;
    *) ONLY="$1"; shift ;;
  esac
done

[ -d "$CLIENTS_DIR" ] || { echo "Aucun dossier clients : $CLIENTS_DIR" >&2; exit 1; }

OK=() KO=() SKIP=()
for dir in "$CLIENTS_DIR"/*/; do
  slug="$(basename "$dir")"
  [ -d "$dir/site/.git" ] || continue
  [ -z "$ONLY" ] || [ "$ONLY" = "$slug" ] || continue

  if [ "$LIST" = 1 ]; then
    printf '%-24s %s\n' "$slug" "$(git -C "$dir/site" describe --tags --always 2>/dev/null)"
    continue
  fi

  echo "==> $slug"
  if [ -n "$(git -C "$dir/site" status --porcelain)" ]; then
    echo "    modifications locales : ignoré"; SKIP+=("$slug"); continue
  fi
  if ( git -C "$dir/site" fetch --tags --quiet origin \
       && git -C "$dir/site" checkout --quiet "$REF" \
       && { git -C "$dir/site" symbolic-ref -q HEAD >/dev/null && git -C "$dir/site" pull --ff-only --quiet origin "$REF" || true; } \
       && cd "$dir" && docker compose build --quiet && docker compose up -d ); then
    echo "    OK ($(git -C "$dir/site" describe --tags --always))"; OK+=("$slug")
  else
    echo "    ECHEC"; KO+=("$slug")
  fi
done

[ "$LIST" = 1 ] && exit 0
echo
echo "Mis à jour : ${#OK[@]}  |  Ignorés : ${#SKIP[@]}  |  Échecs : ${#KO[@]}"
[ "${#SKIP[@]}" -eq 0 ] || echo "Ignorés : ${SKIP[*]}"
[ "${#KO[@]}" -eq 0 ] || { echo "Échecs : ${KO[*]}"; exit 1; }
