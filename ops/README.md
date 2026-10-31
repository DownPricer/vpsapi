# Livrer un nouveau site VTC client

Un client = un tenant en base (API partagée) + un conteneur front indépendant (`vtc-client-<slug>`).

## Installation (une seule fois, sur le VPS)

1. Déployer `src/scripts/createTenant.ts` et la ligne `tenant:create` de `package.json` de l'API (branche `feat/admin-cockpit-redesign`), puis rebuild/redémarrer `vtc-api`.
2. Copier ce dossier `ops/` sur le VPS (ex. `/opt/vtc/ops`).
3. `cp ops.env.example ops.env` puis l'ajuster (surtout `NGINX_CONF_DIR` et `CERTBOT_CMD`).
4. `chmod +x *.sh`

## Nouveau client

```bash
./nouveau-client.sh --slug dupont-vtc --name "Dupont VTC" \
  --domain dupont-vtc.fr --email contact@dupont-vtc.fr --dry-run   # valide sans rien créer
./nouveau-client.sh --slug dupont-vtc --name "Dupont VTC" \
  --domain dupont-vtc.fr --email contact@dupont-vtc.fr
```

Les accès générés sont affichés et enregistrés dans `/opt/vtc/clients/<slug>/ACCES.txt`.
En cas d'erreur après la création du tenant, relancer avec `--skip-tenant`.

## Mettre à jour les clients

```bash
./maj-clients.sh --list          # versions déployées
./maj-clients.sh --ref v1.1      # tous les clients sur le tag v1.1
./maj-clients.sh dupont-vtc      # un seul client
```

Pour déployer proprement : taguer le front (`git tag v1.1 && git push --tags`), puis `maj-clients.sh --ref v1.1`.

## Après la livraison, côté client

`/pro/site` (adresse, téléphone, textes légaux), `/pro/tarifs`, `/pro/vehicules`, `/pro/stripe`.

## Limites connues

- Non testé sur le VPS (aucun accès depuis ce poste) : à essayer d'abord avec un domaine de test.
- Le front est construit avec `next start` ; les `NEXT_PUBLIC_*` sont figées au build, donc un changement de tenant ou d'URL API impose un rebuild.
- Les nouveaux tenants utilisent le moteur tarifaire par défaut de l'API tant qu'aucun tarif n'est enregistré dans `/pro/tarifs`.
- Si `CORS_ORIGINS` est défini sur l'API, y ajouter le domaine du client.
