# Tournoi (projet parallèle) — Login + essai + clé 12 mois + offline grace

## Ce que fait ce projet
- Connexion email/mot de passe (Firebase Auth)
- Mot de passe perdu (email auto Firebase)
- Essai gratuit 10 minutes après login (online-only)
- Clé d’activation => 12 mois
- 1 appareil à la fois (dernier device connecté devient l’appareil actif)
- Offline: autorisé seulement si la licence a été validée en ligne récemment (par défaut: 7 jours)

## Étape 1 — Créer Firebase
1. Firebase Console → Create project
2. Authentication → Sign-in method → active Email/Password
3. Firestore Database → Create database (mode production)
4. Project settings → Your apps → ajoute une app Web
5. Copie firebaseConfig et colle dans js/firebase-config.js

## Étape 2 — Autoriser ton domaine
Authentication → Settings → Authorized domains
Ajoute ton domaine Cloudflare Pages (ex: xxxxx.pages.dev)

## Étape 3 — Règles Firestore
Firestore → Rules → colle FIRESTORE_RULES.txt → Publish

## Étape 4 — Déployer (Cloudflare Pages)
Framework: None
Build command: (vide)
Output dir: /

## Étape 5 — Générer des clés
- Connecte-toi avec l’email admin
- Ouvre /admin.html

## Ajuster l’offline
- Dans js/license.js → OFFLINE_GRACE_DAYS (par défaut 7)
