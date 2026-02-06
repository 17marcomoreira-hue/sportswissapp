import { db, fns } from "./db.js";
import { getOrCreateDeviceId } from "./device.js";

const { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } = fns;

const TRIAL_SECONDS = 10 * 60;

// Offline: autorisé seulement si la licence a été validée en ligne récemment
export const OFFLINE_GRACE_DAYS = 7;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
const ACCESS_CACHE_KEY = "TOURNOI_ACCESS_CACHE_V1";

function loadCache(){ try{ return JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || "null"); }catch{ return null; } }
function saveCache(obj){ localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(obj)); }

export function getOfflineDecision(){
  const c = loadCache();
  if(!c) return { allowed:false, reason:"Aucune validation récente trouvée." };

  const now = Date.now();
  const lastOk = Number(c.lastValidatedAt || 0);
  const expiresAt = Number(c.expiresAt || 0);

  if(!lastOk) return { allowed:false, reason:"Validation absente." };
  if(now - lastOk > OFFLINE_GRACE_MS) return { allowed:false, reason:`Validation trop ancienne (> ${OFFLINE_GRACE_DAYS} jours).` };
  if(!expiresAt || expiresAt <= now) return { allowed:false, reason:"Licence expirée." };

  return { allowed:true, reason:"OK (offline grace)" };
}

export async function ensureUserProfile(user){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    const now = Date.now();
    await setDoc(ref, {
      email: user.email || "",
      createdAt: serverTimestamp(),
      trialStartedAt: now,
      trialSeconds: TRIAL_SECONDS,
      license: { active:false, expiresAt: null, key: null },
      activeDeviceId: null,
      lastLoginAt: serverTimestamp(),
      lastValidatedAt: null
    }, { merge:true });
    return (await getDoc(ref)).data();
  }
  const data = snap.data();
  const patch = {};
  if(!data.trialStartedAt) patch.trialStartedAt = Date.now();
  if(!data.trialSeconds) patch.trialSeconds = TRIAL_SECONDS;
  if(!data.license) patch.license = { active:false, expiresAt:null, key:null };
  if(!("lastValidatedAt" in data)) patch.lastValidatedAt = null;
  patch.lastLoginAt = serverTimestamp();
  if(Object.keys(patch).length) await updateDoc(ref, patch);
  return (await getDoc(ref)).data();
}

export function computeAccess(profile){
  const now = Date.now();
  const licenseActive = !!(profile?.license?.active && profile?.license?.expiresAt && profile.license.expiresAt > now);
  if(licenseActive){
    return { allowed:true, mode:"license", remainingSec: Math.floor((profile.license.expiresAt - now)/1000) };
  }
  const started = Number(profile?.trialStartedAt || 0);
  const total = Number(profile?.trialSeconds || TRIAL_SECONDS);
  const elapsed = Math.max(0, Math.floor((now - started)/1000));
  const remaining = Math.max(0, total - elapsed);
  return { allowed: remaining > 0, mode:"trial", remainingSec: remaining };
}

export async function markValidatedOnline(user, profile){
  const now = Date.now();
  try{
    await updateDoc(doc(db, "users", user.uid), { lastValidatedAt: now });
  }catch(e){
    console.warn("markValidatedOnline failed", e);
  }
  const expiresAt = Number(profile?.license?.expiresAt || 0);
  saveCache({ lastValidatedAt: now, expiresAt });
}

export async function enforceSingleDevice(user){
  const deviceId = getOrCreateDeviceId();
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()) return { ok:true, deviceId };

  const data = snap.data();
  const current = data.activeDeviceId || null;

  if(!current){
    await updateDoc(ref, { activeDeviceId: deviceId, lastDeviceAt: serverTimestamp() });
    return { ok:true, deviceId };
  }
  if(current === deviceId) return { ok:true, deviceId };

  await updateDoc(ref, { activeDeviceId: deviceId, lastDeviceAt: serverTimestamp() });
  return { ok:true, deviceId, replaced:true };
}

export async function activateWithKey(user, keyRaw){
  const key = String(keyRaw||"").trim().toUpperCase();
  if(!key) throw new Error("Clé vide");

  const qy = query(collection(db, "licenseKeys"), where("key", "==", key));
  const res = await getDocs(qy);
  if(res.empty) throw new Error("Clé invalide");
  const docSnap = res.docs[0];
  const keyData = docSnap.data();

  if(keyData.usedBy && keyData.usedBy !== user.uid) throw new Error("Clé déjà utilisée");

  const now = Date.now();
  const expiresAt = now + 365*24*60*60*1000;

  await updateDoc(doc(db, "licenseKeys", docSnap.id), {
    usedBy: user.uid,
    usedEmail: user.email || "",
    usedAt: serverTimestamp(),
    expiresAt
  });

  await updateDoc(doc(db, "users", user.uid), {
    license: { active:true, key, expiresAt },
    licenseActivatedAt: serverTimestamp(),
    lastValidatedAt: now
  });

  saveCache({ lastValidatedAt: now, expiresAt });
  return { key, expiresAt };
}
