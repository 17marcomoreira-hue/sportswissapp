import { waitForAuthReady } from "./auth.js";
import {
  ensureUserProfile,
  computeAccess,
  enforceSingleDevice,
  getOfflineDecision,
  markValidatedOnline
} from "./license.js";

// ---------- helpers affichage ----------
function formatLicenseRemaining(access){
  const sec = Number(access?.remainingSec);
  if(!Number.isFinite(sec) || sec <= 0){
    return { remainingDays: 0, statusText: "Licence expirée" };
  }

  const days = Math.ceil(sec / 86400);

  // Affichage plus fin si < 2 jours
  if(days <= 1){
    const hours = Math.ceil(sec / 3600);
    if(hours <= 1){
      const mins = Math.max(1, Math.ceil(sec / 60));
      return { remainingDays: 1, statusText: `Licence : ~${mins} min restantes` };
    }
    return { remainingDays: 1, statusText: `Licence : ~${hours} h restantes` };
  }

  return {
    remainingDays: days,
    statusText: `Licence : ${days} jour${days > 1 ? "s" : ""} restants`
  };
}

function formatTrialRemaining(access){
  const sec = Math.max(0, Number(access?.remainingSec || 0));
  const mins = Math.ceil(sec / 60);
  if(mins <= 1) return { remainingDays: null, statusText: `Essai : ~${Math.max(1, sec)} s restantes` };
  return { remainingDays: null, statusText: `Essai : ${mins} min restantes` };
}

function enrichAccess(access){
  if(!access) return access;

  if(access.mode === "license"){
    const x = formatLicenseRemaining(access);
    return { ...access, ...x };
  }

  if(access.mode === "trial"){
    const x = formatTrialRemaining(access);
    return { ...access, ...x };
  }

  if(access.mode === "license-offline"){
    return { ...access, remainingDays: null, statusText: "Licence : OK (hors ligne)" };
  }

  return { ...access, remainingDays: null, statusText: "Accès OK" };
}

// ---------- main ----------
export async function requireAccessOrRedirect(){
  const user = await waitForAuthReady();
  if(!user){
    location.href = "./login.html";
    return null;
  }

  // OFFLINE: autorisé seulement si licence validée récemment (grace)
  if(!navigator.onLine){
    const off = getOfflineDecision();
    if(!off.allowed){
      alert("Connexion internet requise.\n\nRaison: " + off.reason);
      location.href = "./login.html";
      return null;
    }
    const access = enrichAccess({ allowed:true, mode:"license-offline", remainingSec:null });
    return { user, profile:null, access, offline:true };
  }

  // ONLINE: contrôle normal
  await enforceSingleDevice(user);
  const profile = await ensureUserProfile(user);
  const access = enrichAccess(computeAccess(profile));

  // Marque une validation récente (utile pour l'offline grace)
  if(access.mode === "license"){
    await markValidatedOnline(user, profile);
  }

  if(!access.allowed){
    location.href = "./activate.html";
    return null;
  }

  return { user, profile, access, offline:false };
}

