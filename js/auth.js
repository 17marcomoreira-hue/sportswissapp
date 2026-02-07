import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export function waitForAuthReady(){
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user || null);
    });
  });
}

export async function login(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signup(email, password){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function resetPassword(email){
  return sendPasswordResetEmail(auth, email);
}

export async function resendVerificationEmail(){
  if(!auth.currentUser) throw new Error("Non connecté.");
  await sendEmailVerification(auth.currentUser);
}

export async function reloadCurrentUser(){
  if(!auth.currentUser) return null;
  await auth.currentUser.reload();
  return auth.currentUser;
}

export async function logout(){
  return signOut(auth);
}
