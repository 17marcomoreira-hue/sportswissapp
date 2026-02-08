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
    document.getElementById("me");
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

function enrichAccess(access) {
  // ✅ Ajoute label + statusText pour app.html
  const remaining = formatRemaining(access);
  const label = access?.mode === "license" ? "Licence" : "Essai";
  return {
    ...access,
    label,
    statusText: `${label} — ${remaining}`
  };
}

function setRemainingText(access) {
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

  // 4) Enforce device unique
  await enforceSingleDevice(user);

  // 5) Calcul d’accès
  const baseAccess = computeAccess(profile);
  const access = enrichAccess(baseAccess);

  // Mets à jour éventuel label dédié
  setRemainingText(access);

  if (!access.allowed) {
    setGateStatus("Accès expiré (essai terminé).");
    // adapte si ta page s'appelle autrement
    window.location.href = "activate.html";
    return { allowed: false, reason: "expired", access };
  }

  // 6) Marquer validation en ligne (offline grace)
  await markValidatedOnline(user, profile);

  // 7) UI status final (bandeau)
  setGateStatus(access.statusText);

  // ✅ IMPORTANT : on renvoie access enrichi (avec statusText/label)
  return { allowed: true, access, user, profile };
}




