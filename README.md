# Folio

Liseuse EPUB personnelle pour Android : une bibliothèque claire, une lecture sans distraction, des passages surlignés, des statistiques de lecture et l'envoi direct des livres vers la Kindle.

## Installer l'application sur le téléphone

1. Sur ton téléphone, ouvre la page **Releases** de ce dépôt (colonne de droite sur GitHub, ou `…/folio/releases`).
2. Dans la dernière version, touche le fichier `folio-1.0.X.apk` pour le télécharger.
3. Ouvre le fichier téléchargé. Android demande d'autoriser l'installation depuis cette source : accepte, puis touche **Installer**.
4. Si Google Play Protect affiche un avertissement (« application inconnue »), choisis **Installer quand même**. C'est normal pour une appli qui ne vient pas du Play Store.

Les mises à jour s'installent par-dessus l'ancienne version sans perdre les données (livres, progression, notes, statistiques).

## Ajouter des livres

- **Bouton +** dans la bibliothèque : ouvre le gestionnaire de fichiers d'Android. Navigue dans tes dossiers et choisis un ou plusieurs fichiers `.epub`.
- **Ouvrir avec Folio** : depuis Mes fichiers, Gmail ou les téléchargements, ouvre un fichier `.epub` et choisis Folio. Le livre s'ouvre directement et rejoint la bibliothèque.
- **Partager vers Folio** depuis une autre appli fonctionne aussi.

Folio garde sa propre copie de chaque livre ; un même fichier n'est jamais ajouté deux fois.

## Fonctionnalités

- **Bibliothèque** : carte « Reprendre » (un tap pour retrouver sa page), grille de couvertures avec la progression, filtres (En cours, À lire, Terminés, Collections), recherche par titre, auteur ou collection, tri.
- **Fiche du livre** (appui long sur un livre) : couverture, résumé, progression, temps de lecture, **Envoyer à ma Kindle**, collections, marquer lu / non lu, retirer.
- **Lecture** : tap au centre pour le menu, sur les côtés pour tourner la page (ou glisser). Menu : progression avec un repère par chapitre, page, pourcentage, temps restant dans le chapitre, sommaire, marque-pages, recherche dans le livre.
- **Affichage** (bouton Aa) : thèmes Papier, Sépia, Ardoise, Nuit ; polices Literata, Source Serif, Atkinson Hyperlegible ou celle du livre ; taille, interligne, marges, justification, césure, défilement continu ; réglages pour tous les livres ou pour ce livre seulement.
- **Lumière** : luminosité (aussi en glissant le doigt sur le bord gauche de l'écran) et chaleur de l'écran.
- **Notes** : sélectionner un passage pour le surligner (4 couleurs) ou le souligner, ajouter une note, copier, partager. L'onglet Notes regroupe tout, avec export en Markdown.
- **Statistiques** : temps de lecture de la semaine jour par jour, série de jours, objectif quotidien, livres terminés par mois, vitesse de lecture. Le temps s'arrête après 2 minutes sans tourner de page.
- **Réglages** : zones de tap, verrouillage des taps, boutons de volume, écran toujours allumé, Kindle, sauvegarde et restauration.

## Envoyer à ma Kindle

Folio envoie le fichier EPUB lui-même, par e-mail, à l'adresse de ta Kindle. Amazon le convertit et il apparaît sur la liseuse quelques minutes plus tard.

À faire une seule fois :

1. **Un compte Gmail pour l'envoi.** Active la validation en deux étapes (Compte Google › Sécurité), puis crée un **mot de passe d'application** (Compte Google › Sécurité › Mots de passe des applications). Les adresses Outlook / Hotmail ne fonctionnent plus pour ce type d'envoi.
2. **Sur Amazon** : Gérer votre contenu et vos appareils › Préférences › Paramètres des documents personnels. Ajoute l'adresse Gmail aux **adresses e-mail approuvées**, et note l'adresse **@kindle.com** de ta liseuse.
3. **Dans Folio** : Réglages › Envoyer à ma Kindle. Indique l'adresse Kindle, l'adresse Gmail et le mot de passe d'application, puis touche **Tester la connexion**.

Le mot de passe est chiffré sur le téléphone (Android Keystore) et n'est jamais réaffiché. Gmail refuse les pièces jointes de plus de 25 Mo.

## Données

Tout reste sur le téléphone. Réglages › Sauvegarde exporte la bibliothèque, la progression, les notes et les statistiques dans un fichier JSON (sans les fichiers EPUB), à réimporter sur un autre téléphone.

## Structure

- `www/` : l'application (HTML, CSS, JavaScript).
  - `js/app.js` : bibliothèque, fiche du livre, notes, statistiques, réglages.
  - `js/reader.js` : le lecteur (epub.js), menus, surlignage, temps de lecture.
  - `js/store.js` : données (localStorage) et cache des couvertures et des pages (IndexedDB).
  - `js/native.js` : pont vers les fonctions Android, avec une version de secours pour tester dans un navigateur.
  - `lib/` : epub.js et JSZip ; `fonts/` : polices embarquées.
- `android/` : projet Android généré par Capacitor.
  - `app/src/main/java/fr/folio/app/FolioPlugin.java` : sélecteur de fichiers, « Ouvrir avec », envoi Kindle (SMTP), mot de passe chiffré, luminosité, écran allumé, boutons de volume, sauvegarde.
  - `app/src/main/AndroidManifest.xml` : déclaration de Folio pour les fichiers `.epub`.
- `scripts/vendor.mjs` : recopie epub.js, JSZip et les polices depuis `node_modules` (`npm run vendor`).
- `assets/` : icône et écran de démarrage (régénérés avec `npx capacitor-assets generate --android`).
- `.github/workflows/build-apk.yml` : compile l'APK et le publie dans les Releases à chaque modification sur `main` (ou à la demande depuis l'onglet **Actions**).

## Modifier l'appli

Tester dans un navigateur : servir le dossier `www/` (par exemple `python3 -m http.server` dans `www/`) et l'ouvrir en mode mobile. Le bouton + accepte alors un fichier EPUB de l'ordinateur ; l'envoi Kindle, la luminosité et les boutons de volume ne fonctionnent que sur le téléphone.
