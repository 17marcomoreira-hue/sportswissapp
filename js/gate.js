import { waitForAuthReady } from "./auth.js";
import {
  ensureUserProfile,
  computeAccess,
  enforceSingleDevice,
  getOfflineDecision,
  markValidatedOnline
} from "./license.js";

export async function requireAccessOrRedirect(){
  const user = await waitForAuthReady();
  if(!user){
    location.href = "./login.html";
    return null;
  }

  // OFFLINE: on autorise seulement si licence validée récemment (grace)
  if(!navigator.onLine){
    const off = getOfflineDecision();
    if(!off.allowed){
      alert("Connexion internet requise.\n\nRaison: " + off.reason);
      location.href = "./login.html";
      return null;
    }
    return { user, profile:null, access:{ allowed:true, mode:"license-offline", remainingSec:null }, offline:true };
  }

  // ONLINE: contrôle normal
  await enforceSingleDevice(user);
  const profile = await ensureUserProfile(user);
  const access = computeAccess(profile);

  if(access.mode === "license"){
    await markValidatedOnline(user, profile);
  }

  if(!access.allowed){
    location.href = "./activate.html";
    return null;
  }

  return { user, profile, access, offline:false };
}
