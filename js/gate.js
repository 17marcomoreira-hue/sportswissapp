import { waitForAuthReady, reloadCurrentUser } from "./auth.js";
import {
  ensureUserProfile,
  computeAccess,
  enforceSingleDevice,
  markValidatedOnline
} from "./license.js";

/* ---------------- UI helpers ---------------- */

function setGateStatus(text) {
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

  const mins = Math.max(0, Math.ceil(sec / 60));
  return `${mins} min restante${mins > 1 ? "s" : ""}`;
}

function enrichAccess(access) {
  const remaining = formatRemaining(access);
  const label = access?.mode === "license" ? "Licence" : "Essai";
  return { ...access, label, statusText: `${label} — ${remaining}` };
}

function setRemainingText(access) {
  const el =
    document.getElementById("remaining") ||
    document.getElementById("remainingDays") ||
    document.getElementById("daysLeft") ||
    document.getElementById("accessRemaining") ||
    document.getElementById("daysRemaining");
  if (el) el.textContent = formatRemaining(access);
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

  const auth = await waitForAuthReady();
  const user0 = auth.currentUser;

  if (!user0) {
    setGateStatus("Connexion requise…");
    redirectToLogin();
    return { allowed: false, reason: "not_signed_in" };
  }

  // ✅ IMPORTANT : forcer la synchro de emailVerified ici aussi (pas seulement au login)
  const user = (await reloadCurrentUser()) || user0;

  // Crée/MAJ profil avec emailVerified frais
  const profile = await ensureUserProfile(user);

  // (Optionnel mais conseillé) : si tu utilises l’override dépannage
  const okEmail = !!user.emailVerified || !!profile.emailVerifiedOverride;
  if (!okEmail) {
    window.location.href = "./verify.html";
    return { allowed: false, reason: "email_not_verified" };
  }

  await enforceSingleDevice(user);

  const baseAccess = computeAccess(profile);
  const access = enrichAccess(baseAccess);
  setRemainingText(access);

  if (!access.allowed) {
    setGateStatus("Accès expiré (essai terminé).");
    window.location.href = "activate.html";
    return { allowed: false, reason: "expired", access };
  }

  await markValidatedOnline(user, profile);
  setGateStatus(access.statusText);

  return { allowed: true, access, user, profile };
}





