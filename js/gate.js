import { waitForAuthReady } from "./auth.js";
import {
  ensureUserProfile,
  computeAccess,
  enforceSingleDevice,
  markValidatedOnline
} from "./license.js";

/* ---------------- UI helpers ---------------- */

function setGateStatus(text) {
  // Bandeau principal (supporte plusieurs ids possibles)
  const el =
    document.getElementById("gateStatus") ||
    document.getElementById("topStatus") ||
    document.getElementById("statusTop") ||
    document.getElementById("accessStatus") ||
    document.getElementById("me"); // fallback fréquent chez toi
  if (el) el.textContent = text;
}

function formatRemaining(access) {
  const sec = Number(access?.remainingSec || 0);

  if (access?.mode === "license") {
    const days = Math.max(0, Math.ceil(sec / 86400));
    return `${days} jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}`;
  }

  // trial
  const mins = Math.max(0, Math.ceil(sec / 60));
  return `${mins} min restante${mins > 1 ? "s" : ""}`;
}

function setRemainingText(access) {
  // Label spécifique "reste" (si ton UI en a un)
  const el =
    document.getElementById("remaining") ||
    document.getElementById("remainingDays") ||
    document.getElementById("daysLeft") ||
    document.getElementById("accessRemaining") ||
    document.getElementById("daysRemaining");
  if (!el) return;

  el.textContent = formatRemaining(access);
}

/* ---------------- Navigation helpers ---------------- */

function currentPathForNext() {
  // pathname + search => fonctionne pour /app, /app.html, etc.
  return window.location.pathname + window.location.search;
}

function redirectToLogin() {
  const next = encodeURIComponent(currentPathForNext());
  window.location.href = `index.html?next=${next}`;
}

/* ---------------- Main gate ---------------- */

export async function requireAccessOrRedirect() {
  setGateStatus("Vérification accès…");

  // 1) Attendre que Firebase Auth soit prêt
  const auth = await waitForAuthReady();
  const user = auth.currentUser;

  // 2) Si pas connecté => redirection login
  if (!user) {
    setGateStatus("Connexion requise…");
    redirectToLogin();
    return { allowed: false, reason: "not_signed_in" };
  }

  // 3) S'assurer que le profil existe / est à jour
  const profile = await ensureUserProfile(user);

  // 4) Enforce device unique (ne crashe pas si appelé trop tôt)
  await enforceSingleDevice(user);

  // 5) Calcul d’accès
  const access = computeAccess(profile);

  // Affichage restant (jours/min)
  setRemainingText(access);

  if (!access.allowed) {
    setGateStatus("Accès expiré (essai terminé).");

    // Si tu as une page d’activation licence, on y va
    // Sinon, renvoie vers login
    // (adapte si ta page s'appelle autrement)
    window.location.href = "activate.html";
    return { allowed: false, reason: "expired", access };
  }

  // 6) Marquer validation en ligne pour autoriser l’offline grace
  await markValidatedOnline(user, profile);

  // 7) UI status final
  const label = access.mode === "license" ? "Licence" : "Essai";
  setGateStatus(`${label} — ${formatRemaining(access)}`);

  return { allowed: true, access, user, profile };
}



