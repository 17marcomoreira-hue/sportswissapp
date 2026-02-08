import { waitForAuthReady } from "./auth.js";
import {
  ensureUserProfile,
  computeAccess,
  enforceSingleDevice,
  markValidatedOnline
} from "./license.js";

// Bandeau en haut (si présent)
function setGateStatus(text) {
  const el =
    document.getElementById("gateStatus") ||
    document.getElementById("topStatus") ||
    document.getElementById("statusTop") ||
    document.getElementById("accessStatus");
  if (el) el.textContent = text;
}

// URL actuelle (pour revenir après login)
function currentPathForNext() {
  // Sur ton site, ça peut être "/app" (route) ou "app.html"
  // On prend pathname + search pour être sûr
  return window.location.pathname + window.location.search;
}

function redirectToLogin() {
  const next = encodeURIComponent(currentPathForNext());
  window.location.href = `index.html?next=${next}`;
}

export async function requireAccessOrRedirect() {
  setGateStatus("Vérification accès…");

  // 1) Attendre que Firebase Auth soit prêt
  const auth = await waitForAuthReady();
  const user = auth.currentUser;

  // 2) Si pas connecté => login
  if (!user) {
    setGateStatus("Connexion requise…");
    redirectToLogin();
    return { allowed: false, reason: "not_signed_in" };
  }

  // 3) S'assurer que le profil existe (création si 1ère connexion)
  const profile = await ensureUserProfile(user);

  // 4) Vérifier / appliquer device unique (ne bloque pas si profil absent)
  await enforceSingleDevice(user);

  // 5) Calcul d’accès
  const access = computeAccess(profile);

  if (!access.allowed) {
    // Ici, tu peux rediriger vers une page "pricing" / "activate"
    // Je mets activate.html si tu l’as, sinon login.
    setGateStatus("Accès expiré (essai terminé).");
    const hasActivate = true; // si tu as activate.html
    window.location.href = hasActivate ? "activate.html" : "index.html";
    return { allowed: false, reason: "expired", access };
  }

  // 6) Marquer validation en ligne (pour offline grace)
  await markValidatedOnline(user, profile);

  setGateStatus(access.mode === "license" ? "Accès licence ✔" : "Accès essai ✔");
  return { allowed: true, access, user, profile };
}


