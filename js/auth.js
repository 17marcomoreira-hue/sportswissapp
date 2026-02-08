import { firebaseConfig } from "./firebase-config.js";

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ✅ IMPORTANT : persistance locale (reste connecté)
let _persistenceReady = null;
function ensurePersistence(){
  if(_persistenceReady) return _persistenceReady;
  _persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
    // Sur certains navigateurs / modes privés, ça peut échouer.
    // On log et on continue avec la persistance par défaut.
    console.warn("Auth persistence not set (continuing with default).", e);
  });
  return _persistenceReady;
}

// ✅ IMPORTANT: lien de vérification vers ton site
const VERIFY_URL = "https://sportswissapp.pages.dev/verify-email.html";
const actionCodeSettings = {
  url: VERIFY_URL,
  handleCodeInApp: true
};

/**
 * Attend l'initialisation Auth et renvoie l'objet auth (et pas seulement user).
 * admin.js fait: const auth = await waitForAuthReady(); const user = auth.currentUser;
 */
export async function waitForAuthReady(){
  await ensurePersistence();

  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve(auth);
    });
  });
}

export async function login(email, password){
  await ensurePersistence();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signup(email, password){
  await ensurePersistence();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user, actionCodeSettings);
  return cred.user;
}

export async function resetPassword(email){
  await ensurePersistence();
  return sendPasswordResetEmail(auth, email);
}

export async function resendVerificationEmail(){
  await ensurePersistence();
  if(!auth.currentUser) throw new Error("Non connecté.");
  await sendEmailVerification(auth.currentUser, actionCodeSettings);
}

export async function reloadCurrentUser(){
  await ensurePersistence();
  if(!auth.currentUser) return null;
  await auth.currentUser.reload();
  return auth.currentUser;
}

export async function logout(){
  await ensurePersistence();
  return signOut(auth);
}



