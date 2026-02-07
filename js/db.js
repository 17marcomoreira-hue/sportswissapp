import { firebaseConfig } from "./firebase-config.js";

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, orderBy, limit,
  getDocs, addDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ✅ Réutilise l'app existante si déjà initialisée
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const fns = {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, orderBy, limit,
  getDocs, addDoc,
  serverTimestamp,
  Timestamp
};

