# Mettre BATSCORES en ligne

Ce guide part du principe que vous n'avez jamais heberge de site. Chaque
commande est a taper telle quelle ; ce qui est **en gras** est a remplacer par
votre valeur.

Comptez une heure la premiere fois. Ensuite, une mise a jour prend trente
secondes.

---

## 1. Ce qu'il vous faut

| Element | Pourquoi | Cout indicatif |
| --- | --- | --- |
| Un VPS (serveur loue) | Votre telephone s'eteint et change d'adresse ; un serveur reste allume | 4 a 6 € / mois |
| Un nom de domaine | Pour taper `batscores.fr` plutot qu'une suite de chiffres | 8 a 12 € / an |
| Votre cle API-Football | Deja acquise | — |

**Pourquoi pas Termux ?** Termux sert a developper et a tester. Il ne peut pas
heberger un site accessible : votre telephone n'a pas d'adresse fixe, il passe
en veille, et sa connexion mobile bloque les connexions entrantes.

**Quel VPS ?** N'importe quel modele d'entree de gamme suffit : 1 processeur,
1 Go de memoire, 20 Go de disque. Hetzner (CX22, ~4 €), Scaleway (Stardust,
~4 €) et OVH (VPS Value, ~5 €) conviennent tous. Prenez un centre de donnees
en Europe pour la latence, et **Ubuntu 24.04 LTS** comme systeme.

Au moment de la creation, l'hebergeur vous demande une **cle SSH**. Si vous
n'en avez pas, creez-la sur votre machine (ou dans Termux) :

```bash
ssh-keygen -t ed25519 -C "batscores"
cat ~/.ssh/id_ed25519.pub    # copiez cette ligne dans le formulaire
```

Ne partagez jamais le fichier sans `.pub` : c'est votre cle privee.

---

## 2. Se connecter au serveur

L'hebergeur vous donne une adresse IP, par exemple `203.0.113.42`.

```bash
ssh root@203.0.113.42
```

À la premiere connexion, il demande de confirmer l'empreinte : repondez `yes`.

### Creer un utilisateur non privilegie

Travailler en `root` en permanence, c'est n'avoir aucun filet : la moindre
faute de frappe s'execute avec tous les droits.

```bash
adduser batscores            # choisissez un mot de passe, le reste : Entree
usermod -aG sudo batscores
rsync --archive --chown=batscores:batscores ~/.ssh /home/batscores
```

Deconnectez-vous (`exit`) et reconnectez-vous avec le nouveau compte :

```bash
ssh batscores@203.0.113.42
```

### Fermer les portes inutiles

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable              # repondez y
sudo ufw status
```

Seuls SSH, HTTP et HTTPS sont joignables. Le port 3000 de l'application reste
volontairement ferme de l'exterieur : on y accedera par le proxy.

---

## 3. Installer Node 22

Le collecteur exige Node 22 (il utilise `node:sqlite`, absent avant). Ubuntu
livre une version plus ancienne, on ajoute donc le depot officiel :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version               # doit afficher v22.x
```

---

## 4. Installer BATSCORES

```bash
cd ~
git clone https://github.com/rubenboga615-boop/BATSCORES.git
cd BATSCORES
npm ci --omit=dev
```

`npm ci` installe exactement les versions du fichier `package-lock.json`, et
`--omit=dev` laisse de cote les outils de test, inutiles en production.

### Configurer la cle API

```bash
cp .env.example .env
nano .env
```

Remplacez `votre_cle_api_ici` par votre vraie cle, puis :

```
HOST=127.0.0.1
TRUST_PROXY=1
```

Enregistrez avec `Ctrl+O`, `Entree`, puis `Ctrl+X`.

> `HOST=127.0.0.1` fait ecouter l'application sur la machine uniquement. Sans
> cela, votre site resterait joignable en clair sur le port 3000, en
> contournant le HTTPS.

**Ne modifiez jamais `.env.example`** : ce fichier est versionne et partirait
sur GitHub avec votre cle dedans. Seul `.env` contient des secrets, et il est
ignore par git.

### Verifier que ca demarre

```bash
node server/index.js
```

Vous devez lire `BATSCORES demarre sur http://127.0.0.1:3000`. Dans un autre
terminal, ou apres `Ctrl+C` :

```bash
curl -s http://127.0.0.1:3000/api/health
```

Si la reponse contient `"status":"ok"`, l'application fonctionne. Arretez-la
avec `Ctrl+C` : PM2 va prendre le relais.

---

## 5. Garder l'application allumee avec PM2

Sans PM2, l'application s'arrete des que vous fermez le terminal, et ne
redemarre pas si le serveur reboote.

```bash
sudo npm install -g pm2
cd ~/BATSCORES
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                  # copiez-collez la commande qu'il affiche
```

Commandes utiles :

```bash
pm2 status                   # en marche ?
pm2 logs batscores           # journaux en direct (Ctrl+C pour sortir)
pm2 restart batscores        # apres une mise a jour
pm2 monit                    # memoire et processeur
```

> Le fichier `ecosystem.config.cjs` lance **un seul** processus, volontairement.
> Le mode « cluster » de PM2 en lancerait plusieurs, chacun avec son propre
> cache et son propre limiteur de debit : votre quota d'appels fondrait aussi
> vite qu'il y a d'instances, pour servir le meme trafic.

---

## 6. Nom de domaine et HTTPS

### Faire pointer le domaine

Chez votre registraire (OVH, Gandi, Namecheap...), dans la zone DNS, creez :

| Type | Nom | Valeur |
| --- | --- | --- |
| A | `@` | **203.0.113.42** |
| A | `www` | **203.0.113.42** |

La propagation prend de quelques minutes a quelques heures. Verifiez avec :

```bash
dig +short batscores.exemple.fr
```

Attendez que votre adresse IP s'affiche avant de continuer : Caddy a besoin
que le domaine pointe deja vers le serveur pour obtenir le certificat.

### Installer Caddy

Caddy est un serveur web qui obtient et renouvelle le certificat HTTPS tout
seul, sans configuration.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Puis reprenez le modele fourni :

```bash
sudo cp ~/BATSCORES/Caddyfile.exemple /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # remplacez batscores.exemple.fr
sudo systemctl reload caddy
```

Ouvrez `https://votre-domaine` dans un navigateur : le cadenas doit apparaitre.
En cas de probleme :

```bash
sudo journalctl -u caddy -n 50 --no-pager
```

---

## 7. Mettre a jour

À chaque nouvelle version :

```bash
cd ~/BATSCORES
git pull
npm ci --omit=dev
pm2 restart batscores
```

Le service worker de l'application va chercher le reseau en premier : la
nouvelle version apparait des le rechargement de la page, sans vider le cache.

Si `git pull` refuse d'avancer en signalant un fichier modifie localement,
c'est presque toujours `.env.example`. Recuperez la version du depot :

```bash
git checkout -- .env.example
git pull
```

Votre `.env`, lui, n'est jamais touche par `git pull`.

---

## 8. Faire tourner le collecteur

Le collecteur est independant de l'application web. Il peut tourner sur le meme
serveur.

```bash
cd ~/BATSCORES
npm ci                       # cette fois avec les outils, le collecteur en a besoin

# Chiffrer avant de depenser : cette commande ne consomme aucun appel
npm run collect -- plan --league 61 --season 2025 --profile complet

# Collecter
npm run collect -- run --league 61 --season 2025 --profile complet
```

### Automatiser le releve des cotes

La derive des cotes n'existe qu'a partir de deux releves. Un releve toutes les
six heures suffit a dessiner une courbe :

```bash
crontab -e
```

Ajoutez :

```cron
0 */6 * * * cd /home/batscores/BATSCORES && /usr/bin/npm run collect -- cotes --league 61 --season 2025 --quiet && /usr/bin/npm run collect -- run --league 61 --season 2025 --profile complet --max-calls 200 --quiet >> /home/batscores/collecte.log 2>&1
```

`--max-calls 200` borne la depense : meme si quelque chose tourne mal, la nuit
ne peut pas vider votre quota.

### Piloter la collecte depuis l'interface

Par defaut, la page « Collecte » est en lecture seule : personne ne peut lancer
de collecte depuis un navigateur, et donc personne ne peut vider votre quota.
Pour activer les boutons, posez une phrase secrete dans `.env` :

```
COLLECTOR_ADMIN_TOKEN=une-phrase-longue-et-difficile-a-deviner
```

Puis `pm2 restart batscores`. Laissez ce champ vide si votre site est public.

---

## 9. Activer les notifications

Elles sont eteintes tant que vous n'avez pas genere de cles.

```bash
cd ~/BATSCORES
npm run vapid
```

Collez les trois lignes affichees a la fin de votre `.env`, en remplacant
l'adresse par la votre, puis :

```bash
pm2 restart batscores
```

Sur le site, allez dans **Favoris** : un bouton « Activer les notifications »
apparait. Le navigateur demandera l'autorisation ; une fois accordee, vous
recevrez le coup d'envoi, les buts, la mi-temps et le resultat final de vos
matchs suivis, meme application fermee.

Trois points a savoir :

- **HTTPS obligatoire.** Les notifications ne fonctionnent pas en HTTP, sauf sur
  `localhost`. Si vous n'avez pas encore de domaine, le bouton echouera.
- **Sur iPhone**, il faut d'abord ajouter BATSCORES a l'ecran d'accueil
  (bouton Partager, « Sur l'ecran d'accueil »). Safari ne gere les
  notifications que pour les applications ainsi installees.
- **Ne regenerez pas les cles.** Tous les appareils deja abonnes cesseraient de
  recevoir quoi que ce soit et devraient se reabonner.

Le fichier `data/push-subscriptions.json` contient la liste des appareils. Le
supprimer desabonne tout le monde ; c'est sans danger.

### Ce que cela coute en quota

Le veilleur ne consulte le fournisseur que si une rencontre suivie est en cours
ou commence dans les dix minutes. Le reste du temps, il se rendort sans depenser
un appel. Pendant un match, c'est un appel par minute pour l'ensemble des
rencontres suivies — pas un par match. Un week-end charge coute quelques
centaines d'appels sur les 7 500 quotidiens.

## 10. Choisir ses sources d'actualites

La page **Actus** lit des flux RSS. Sans reglage, elle utilise trois sources
francaises. Pour choisir les votres, ajoutez a `.env` :

```
NEWS_FEEDS=L'Equipe|https://www.lequipe.fr/rss/actu_rss_Football.xml,Mon Media|https://exemple.fr/rss
```

Les entrees sont separees par des virgules, jamais par des espaces — les noms
de sources en contiennent. Puis `pm2 restart batscores`.

Ces flux sont lus par le serveur, pas par le navigateur : la page ne suit
aucune adresse fournie par un visiteur.

## 11. Sauvegarder

Ce qui a de la valeur, c'est la base collectee : elle represente des milliers
d'appels payes.

```bash
# Sauvegarde locale, chaque nuit
crontab -e
```

```cron
30 3 * * * cd /home/batscores/BATSCORES && sqlite3 data/batscores.db ".backup /home/batscores/sauvegardes/batscores-$(date +\%F).db"
```

```bash
mkdir -p ~/sauvegardes
sudo apt install -y sqlite3
```

Sauvegardez aussi `data/push-subscriptions.json` si vous tenez a ne pas obliger
vos utilisateurs a se reabonner apres une reinstallation.

Puis rapatriez de temps en temps une copie sur votre machine :

```bash
scp batscores@203.0.113.42:~/sauvegardes/batscores-*.db .
```

> `.backup` de SQLite copie une base en cours d'utilisation sans la corrompre,
> contrairement a un simple `cp`.

---

## 12. En cas de panne

| Symptome | Verifier |
| --- | --- |
| Le site ne repond pas | `pm2 status` puis `pm2 logs batscores` |
| « Cle API refusee » | `.env` contient-il la vraie cle ? `pm2 restart batscores` apres modification |
| Certificat absent | `dig +short votre-domaine` renvoie-t-il bien l'IP ? puis `sudo journalctl -u caddy -n 50` |
| Quota epuise | `npm run collect -- status` affiche la consommation du jour |
| Disque plein | `df -h` ; la base grossit, les journaux PM2 aussi (`pm2 flush`) |
| Bouton de notification absent | Site en HTTPS ? Cles VAPID dans `.env` ? `pm2 restart batscores` |
| Page Actus vide | `curl -s localhost:3000/api/news \| head` ; une source en panne est nommee dans la reponse |

---

## Cout total

| Poste | Par mois |
| --- | --- |
| VPS | 4 à 6 € |
| Domaine | ~1 € (lisse sur l'annee) |
| API-Football Pro | deja paye |
| **Total** | **5 à 7 € / mois** |
