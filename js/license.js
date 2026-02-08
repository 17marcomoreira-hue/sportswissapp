import { db, fns } from "./db.js";
import { getOrCreateDeviceId } from "./device.js";

// docId = clé => getDoc direct
const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = fns;

// ---- Constantes ----
export const TRIAL_SECONDS_DEFAULT = 10 * 60;
export const LICENSE_KEYS_COLLECTION = "licenseKeys";

// Offline: autorisé seulement si la licence a été validée en ligne récemment
export const OFFLINE_GRACE_DAYS = 7;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
const ACCESS_CACHE_KEY = "TOURNOI_ACCESS_CACHE_V1";

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}
function saveCache(obj) {
  localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(obj));
}

export function isAdminEmail(email, adminEmail) {
  return (email || "").toLowerCase() === (adminEmail || "").toLowerCase();
}

export function addMonthsMillis(baseMillis, months) {
  const d = new Date(baseMillis);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d.getTime();
}

export function getOfflineDecision() {
  const c = loadCache();
  if (!c) return { allowed: false, reason: "Aucune validation récente trouvée." };

  const now = Date.now();
  const lastOk = Number(c.lastValidatedAt || 0);
  const expiresAt = Number(c.expiresAt || 0);

  if (!lastOk) return { allowed: false, reason: "Validation absente." };
  if (now - lastOk > OFFLINE_GRACE_MS)
    return {
      allowed: false,
      reason: `Validation trop ancienne (> ${OFFLINE_GRACE_DAYS} jours).`,
    };
  if (!expiresAt || expiresAt <= now) return { allowed: false, reason: "Licence expirée." };

  return { allowed: true, reason: "OK (offline grace)" };
}

// --------------------------
// Profil user Firestore
// --------------------------
export async function ensureUserProfile(user) {
  if (!user || !user.uid) throw new Error("Utilisateur non connecté.");

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  const basePatch = {
    uid: user.uid,
    email: user.email || "",
    emailVerified: !!user.emailVerified,
    lastLoginAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    const now = Date.now();
    await setDoc(
      ref,
      {
        ...basePatch,
        createdAt: serverTimestamp(),
        trialStartedAt: now,
        trialSeconds: TRIAL_SECONDS_DEFAULT,
        license: { active: false, expiresAt: null, key: null, status: "none" },
        activeDeviceId: null,
        lastDeviceAt: null,
        lastValidatedAt: null,
        adminResendVerify: false,
      },
      { merge: true }
    );
    return (await getDoc(ref)).data();
  }

  const data = snap.data();
  const patch = { ...basePatch };

  if (!data.trialStartedAt) patch.trialStartedAt = Date.now();
  if (!data.trialSeconds) patch.trialSeconds = TRIAL_SECONDS_DEFAULT;
  if (!data.license) patch.license = { active: false, expiresAt: null, key: null, status: "none" };
  if (!("lastValidatedAt" in data)) patch.lastValidatedAt = null;
  if (!("adminResendVerify" in data)) patch.adminResendVerify = false;

  await updateDoc(ref, patch);
  return (await getDoc(ref)).data();
}

export function computeAccess(profile) {
  const now = Date.now();
  const lic = profile?.license || null;
  const licenseActive = !!(lic?.active && lic?.expiresAt && lic.expiresAt > now);

  if (licenseActive) {
    return {
      allowed: true,
      mode: "license",
      remainingSec: Math.floor((lic.expiresAt - now) / 1000),
    };
  }

  const started = Number(profile?.trialStartedAt || 0);
  const total = Number(profile?.trialSeconds || TRIAL_SECONDS_DEFAULT);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const remaining = Math.max(0, total - elapsed);

  return { allowed: remaining > 0, mode: "trial", remainingSec: remaining };
}

export async function markValidatedOnline(user, profile) {
  if (!user || !user.uid) return;

  const now = Date.now();
  try {
    await updateDoc(doc(db, "users", user.uid), { lastValidatedAt: now });
  } catch (e) {
    console.warn("markValidatedOnline failed", e);
  }
  const expiresAt = Number(profile?.license?.expiresAt || 0);
  saveCache({ lastValidatedAt: now, expiresAt });
}

// --------------------------
// Single-device: NE DOIT PAS CRASHER si user absent
// --------------------------
export async function enforceSingleDevice(user) {
  // ✅ garde-fou : si gate.js appelle trop tôt
  if (!user || !user.uid) {
    return { ok: false, reason: "User not signed in" };
  }

  const deviceId = getOrCreateDeviceId();
  const ref = doc(db, "users", user.uid);

  const snap = await getDoc(ref);

  // Profil pas encore créé => on ne bloque pas ici
  if (!snap.exists()) {
    return { ok: true, deviceId, created: false };
  }

  const data = snap.data();
  const current = data.activeDeviceId || null;

  if (!current || current === deviceId) {
    await updateDoc(ref, { activeDeviceId: deviceId, lastDeviceAt: serverTimestamp() });
    return { ok: true, deviceId };
  }

  // Remplace l'autre appareil
  await updateDoc(ref, { activeDeviceId: deviceId, lastDeviceAt: serverTimestamp() });
  return { ok: true, deviceId, replaced: true };
}

// --------------------------
// Admin: générer des clés (docId = clé)
// --------------------------
export async function adminGenerateKeys(count, months) {
  const n = Math.max(1, Math.min(500, Number(count || 1)));
  const m = Number(months || 12);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const makeKey = () => `${part(4)}-${part(4)}-${part(4)}`;

  for (let i = 0; i < n; i++) {
    const key = makeKey();
    await setDoc(doc(db, LICENSE_KEYS_COLLECTION, key), {
      key,
      months: m,
      revoked: false,
      createdAt: serverTimestamp(),
      usedBy: null,
      usedEmail: null,
      usedAt: null,
      expiresAt: null,
    });
  }
}

// --------------------------
// Activation licence (docId = clé)
// --------------------------
export async function activateWithKey(user, keyRaw) {
  if (!user || !user.uid) throw new Error("Utilisateur non connecté.");

  const key = String(keyRaw || "").trim().toUpperCase();
  if (!key) throw new Error("Clé vide");

  const keyRef = doc(db, LICENSE_KEYS_COLLECTION, key);
  const keySnap = await getDoc(keyRef);

  if (!keySnap.exists()) throw new Error("Clé invalide");

  const keyData = keySnap.data();

  if (keyData.revoked) throw new Error("Clé révoquée");
  if (keyData.usedBy && keyData.usedBy !== user.uid) throw new Error("Clé déjà utilisée");

  const nowMs = Date.now();
  const months = Number(keyData.months || 12);
  const expiresAt = addMonthsMillis(nowMs, months);

  await updateDoc(keyRef, {
    usedBy: user.uid,
    usedEmail: user.email || "",
    usedAt: serverTimestamp(),
    expiresAt,
  });

  await updateDoc(doc(db, "users", user.uid), {
    license: { active: true, key, expiresAt, status: "active" },
    licenseActivatedAt: serverTimestamp(),
    lastValidatedAt: nowMs,
  });

  saveCache({ lastValidatedAt: nowMs, expiresAt });
  return { key, expiresAt, months };
}


