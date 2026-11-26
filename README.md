# Soul Forge

![CI](https://github.com/TON-PSEUDO/soul-forge/actions/workflows/ci.yml/badge.svg) ![Node](https://img.shields.io/badge/node-%E2%89%A518-5be3a8) ![Licence](https://img.shields.io/badge/licence-MIT-8c78ff)

![Aperçu](public/og.png)

Interface **néon** (orbe réacteur, grille synthwave, particules lumineuses, couleurs qui suivent ton affinité).

Éveille ton zanpakutō : monte en niveau, choisis ton affinité, débloque ton **Shikai** puis ton **Bankai**, et garde ta progression avec une **sauvegarde téléchargeable**.

Site 100 % statique servi par un petit serveur Node **sans aucune dépendance**. Fan project non officiel, les zanpakutō sont des créations originales.

## Fonctionnalités

- 5 affinités (Feu, Glace, Foudre, Ombre, Vent), chacune avec son zanpakutō, sa phrase de Shikai et son Bankai
- Épreuves de libération : Shikai (niveau 10), Bankai (niveau 30 + 15 victoires en forme Shikai)
- **Noms personnalisés** : nom du Shikai, phrase d’invocation et nom du Bankai (inclus dans les sauvegardes)
- Formes jouables (Scellé / Shikai / Bankai) avec bonus de puissance et de reiatsu
- Entraînement (3 améliorations), combats contre des Hollows, progression hors-ligne
- **Sauvegarde** :
  - automatique dans le navigateur (localStorage)
  - **fichier `.json` téléchargeable** et rechargeable (avec somme de contrôle)
  - **code de sauvegarde** `SF1.…` à copier-coller
  - **sauvegarde Discord** : envoi dans un salon via webhook, puis restauration avec un code `SFD-…` (voir plus bas)
- Responsive, animations désactivées si `prefers-reduced-motion`

## Lancer en local

```bash
node server.js
# puis ouvre http://localhost:3000
```

Node 18+ suffit, il n'y a rien à installer.

## Mettre sur GitHub

```bash
git init
git add .
git commit -m "Soul Forge"
git branch -M main
git remote add origin https://github.com/TON-PSEUDO/soul-forge.git
git push -u origin main
```

(Crée d'abord un dépôt vide `soul-forge` sur github.com.)

## Déployer sur Railway

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → `soul-forge`
2. **Settings → Networking → Generate Domain**
3. (Optionnel) onglet **Variables** : `DISCORD_WEBHOOK_URL` pour activer la sauvegarde Discord

Railway lit `railway.json` : build via le `Dockerfile` (image `node:22-alpine`, utilisateur non-root), healthcheck sur `/health`, redémarrage automatique en cas d'échec. Le serveur gère `SIGTERM` pour que chaque redéploiement se fasse sans coupure brutale.

## Connexion Discord & panel admin

Le site demande une **connexion Discord** (OAuth2, scope `identify` : pseudo + avatar, rien d'autre). Le compte Discord **`653263485362503693`** est le **fondateur**. Le panel est sur **`/admin`**.

| Rôle | Droits |
| --- | --- |
| **Fondateur** | Tout : nommer / retirer des admins (même par ID, avant leur 1re connexion), bannir tout le monde sauf lui-même. Ne peut être ni banni ni rétrogradé. |
| **Admin** | Vue d'ensemble, liste des joueurs, bannir / débannir les joueurs, annonce, maintenance, journal. |
| **Joueur** | Le jeu. |

Le panel contient : statistiques (joueurs, actifs 24 h / 7 j, affinités, meilleurs niveaux, état du serveur), recherche et gestion des joueurs (ban avec raison affichée au joueur), **annonce** affichée en haut du jeu, **mode maintenance** (l'équipe garde l'accès), **sauvegardes de la base** et **journal d'audit**.

### Donner des récompenses (bouton « Donner »)

Dans l'onglet **Joueurs**, chaque ligne a un bouton **Donner** (admins et fondateur) : **⚡ Tout donner** (niveau 100, Shikai, Bankai, améliorations à 500, 1 000 Md de reiatsu (l'argent du jeu), 100 victoires) ou un cadeau sur mesure : niveau, XP, reiatsu, victoires, Concentration / Aura / Discipline, affinité, Shikai, Bankai, forme active. Le **fondateur** peut aussi **donner à tous les joueurs** d'un coup (bannis exclus).

- Le cadeau est mis en file sur le serveur ; le jeu le récupère à la prochaine synchro du joueur (≤ 1 min en ligne, sinon à la connexion), l'applique, affiche « Cadeau de l'équipe : … » puis l'acquitte. Un cadeau n'est jamais appliqué deux fois.
- Niveau, améliorations et déblocages ne font qu'**augmenter** ; reiatsu, XP et victoires **s'ajoutent**. Si le joueur n'a pas d'affinité et que le cadeau contient Shikai/Bankai, il reçoit l'affinité Feu (ou celle choisie dans le cadeau).
- Max 20 cadeaux en attente par joueur. Tout est tracé dans le journal (`give`, `give-all`).

### Sauvegardes de la base (onglet « Sauvegardes »)

Le panel sauvegarde `db.json` (joueurs, rôles, bans, annonce, maintenance, journal) dans `DATA_DIR/backups/`, avec somme de contrôle.

- **Automatique** : une par jour, les 7 dernières sont gardées. **Manuelle** : bouton « Sauvegarder maintenant » (admins et fondateur), 20 gardées.
- **Fondateur uniquement** : télécharger, restaurer (depuis la liste ou un fichier `.json`), supprimer. La base contient tous les joueurs, d'où la restriction.
- Une restauration remplace **toute** la base ; un instantané « avant restauration » est créé juste avant (5 gardés), et tout est tracé dans le journal.
- Sans Volume Railway, `DATA_DIR/backups` est effacé à chaque déploiement : télécharge de temps en temps une sauvegarde chez toi.
- Ce n'est pas la sauvegarde de progression des joueurs (voir « Sauvegarde Discord » plus bas).

### Mise en place

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → onglet **OAuth2** :
   - copie le **Client ID** et le **Client Secret**
   - **Redirects** → ajoute `https://TON-DOMAINE.up.railway.app/auth/callback` (exactement cette URL ; ajoute aussi `http://localhost:3000/auth/callback` pour le local)
2. Railway → onglet **Variables** :

| Variable | Rôle |
| --- | --- |
| `DISCORD_CLIENT_ID` | requis |
| `DISCORD_CLIENT_SECRET` | requis |
| `SESSION_SECRET` | conseillé : longue chaîne aléatoire (`openssl rand -hex 32`) |
| `BASE_URL` | conseillé : `https://TON-DOMAINE.up.railway.app` (sert à construire l'URL de retour) |
| `FOUNDER_ID` | facultatif, défaut `653263485362503693` |
| `REQUIRE_LOGIN` | `false` pour laisser jouer sans compte (le panel exige toujours Discord) |
| `DATA_DIR` | dossier des données, voir ci-dessous |
| `DISCORD_WEBHOOK_URL` | sauvegarde Discord (inchangé) |

3. **Données persistantes** : les joueurs, bans, annonces et le journal sont dans `DATA_DIR/db.json`. Sans volume, Railway les efface à chaque redéploiement. Railway → **Volume** → monte-le sur `/data`, puis ajoute `DATA_DIR=/data` et `RAILWAY_RUN_UID=0` (permissions d'écriture pour l'utilisateur non-root du conteneur).
4. Sans `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, la connexion est désactivée : le jeu reste ouvert et `/admin` affiche « indisponible ».

### Local

```bash
DISCORD_CLIENT_ID=… DISCORD_CLIENT_SECRET=… BASE_URL=http://localhost:3000 node server.js
```

### Limites à connaître

- La progression reste **dans le navigateur** du joueur : le panel affiche le résumé que le jeu lui envoie (niveau, affinité, forme, victoires), ce n'est pas une preuve anti-triche et le panel ne modifie pas directement une sauvegarde : il envoie des cadeaux que le jeu applique côté joueur (voir « Donner des récompenses »).
- La connexion sert à identifier les joueurs et à pouvoir les bannir ; le code du jeu lui-même (`app.js`) reste public, comme tout site statique.
- Un ban agit immédiatement (vérifié à chaque requête). Les sessions durent 30 jours.

## Aperçu de partage

Les liens collés sur Discord, X ou WhatsApp affichent `public/og.png` (1200×630). Le serveur injecte l'URL réelle du site dans les balises Open Graph : rien à configurer, même avec un domaine personnalisé. Le jeu est aussi installable comme application (manifest + icônes).

## Qualité

```bash
npm test   # 14 tests : serveur statique + connexion Discord (faux Discord local), rôles, bans, maintenance, sauvegardes
```

La CI GitHub (`.github/workflows/ci.yml`) lance les tests sur Node 18/20/22 et vérifie que l'image Docker démarre. Dependabot garde Actions et l'image à jour.

## Sauvegarde Discord

Le joueur clique sur **Envoyer sur Discord** : le serveur poste dans ton salon un message (niveau, affinité, forme, victoires) avec le fichier `.json` en pièce jointe, et renvoie un code `SFD-<id>-<clé>`. Pour restaurer, il colle le code puis clique sur **Importer depuis Discord** (la somme de contrôle est revérifiée et une confirmation est demandée). Le fichier joint reste aussi importable à la main via « Charger un fichier ».

**Mise en place**

1. Dans Discord : salon privé → **Modifier le salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL**.
2. Définis la variable d'environnement `DISCORD_WEBHOOK_URL` avec cette URL (sur Railway : onglet **Variables**). En local : `DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…" node server.js`.
3. Sans cette variable, le bloc Discord est simplement masqué et le reste du jeu fonctionne comme avant.

**Sécurité et limites**

- L'URL du webhook ne quitte jamais le serveur ; elle ne doit jamais être mise dans le code ni sur GitHub.
- Seul un hash de la clé est écrit dans le message Discord : connaître l'id d'un message ne permet pas de relire la sauvegarde. Les gens qui ont accès au salon, eux, peuvent télécharger les fichiers : garde-le privé.
- Taille max 20 Ko, limite de débit par IP (6 envois et 20 restaurations par 10 minutes, en mémoire).
- La restauration lit le message d'origine : si tu le supprimes sur Discord, le code ne marche plus.

## Structure

```
soul-forge/
├── server.js        # serveur statique + /health + API + routage
├── lib/             # store.js (base JSON), auth.js (OAuth Discord, rôles), admin-api.js
├── admin/           # panel /admin (réservé à l'équipe)
├── Dockerfile       # image Railway
├── railway.json     # config Railway
├── test/            # tests (node:test)
├── .github/         # CI, Dependabot, modèles
├── package.json
├── .gitignore
└── public/
    ├── index.html
    ├── style.css
    ├── login.html   # page de connexion Discord
    ├── session.js   # puce utilisateur, annonce, résumé de progression
    └── app.js       # toute la logique du jeu
```

## Personnaliser

- Ajouter / modifier un zanpakutō : tableau `AFFINITIES` en haut de `public/app.js`
- Équilibrage : constantes `SHIKAI_LEVEL`, `BANKAI_LEVEL`, `BANKAI_MASTERY`, `TRIAL_POWER`, `FORMS` et `UPGRADES`

## À savoir sur la sauvegarde

La progression est stockée **dans le navigateur** de chaque joueur (le serveur ne garde rien). Pour changer d'appareil ou ne rien perdre en vidant le navigateur, utiliser le fichier ou le code de sauvegarde. La somme de contrôle détecte un fichier abîmé, ce n'est pas un système anti-triche.

## Licence

MIT
