// js/storage.js — ULTRA COMPAT + Firestore-safe
// - Import/Export local (localStorage) + téléchargement JSON
// - Snapshots cloud (Firestore) en doc unique "latest" => réduit énormément quota
// - Exports "compat" pour éviter les erreurs d'imports (gate/admin/license)

import { auth } from "./auth.js";
import { db, fns } from "./db.js";

const {
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, addDoc, query, orderBy, limit,
  serverTimestamp
} = fns;

/* -------------------- DOWNLOAD HELPERS -------------------- */

export function downloadJson(filename, data){
  // ✅ Supporte aussi l'appel downloadJson(data) (sans filename)
  if (data === undefined && filename !== undefined && typeof filename === "object") {
    data = filename;
    filename = "export.json";
  }

  const name = String(filename ?? "export.json");
  const safeName = name.replace(/[^\w.\-]+/g, "_");

  const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], {
    type: "application/json;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* -------------------- LOCAL STORAGE EXPORT/IMPORT -------------------- */

export function getAllLocalStorage(){
  const out = {};
  for(let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    out[k] = localStorage.getItem(k);
  }
  return out;
}

export function clearLocalStorage(){
  localStorage.clear();
}

export function uploadJsonToLocalStorage(objOrJson, { clearFirst=false } = {}){
  let obj = objOrJson;
  if(typeof objOrJson === "string"){
    obj = JSON.parse(objOrJson);
  }
  if(!obj || typeof obj !== "object") throw new Error("JSON invalide.");

  if(clearFirst) clearLocalStorage();

  for(const [k,v] of Object.entries(obj)){
    localStorage.setItem(k, String(v));
  }
}

/* -------------------- AUTH HELPER -------------------- */

function requireUser(){
  const u = auth.currentUser;
  if(!u) throw new Error("Utilisateur non connecté.");
  return u;
}

function snapshotsCol(uid){
  return collection(db, "users", uid, "snapshots");
}

/* -------------------- FIRESTORE SANITIZE -------------------- */

export function sanitizeForFirestore(value){
  const seen = new WeakSet();

  const walk = (v)=>{
    if(v === null || v === undefined) return null;

    const t = typeof v;

    if(t === "string" || t === "number" || t === "boolean") return v;

    if(v instanceof Date) return v.toISOString();

    if(t === "object"){
      if(seen.has(v)) return null;
      seen.add(v);

      if(Array.isArray(v)) return v.map(walk);

      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }

    return null;
  };

  return walk(value);
}

/* -------------------- CLOUD SNAPSHOTS (Firestore) -------------------- */

// ✅ ÉCRITURE: doc unique "latest" (au lieu de addDoc à l’infini)
export async function cloudSaveSnapshot(data, label="Snapshot"){
  const u = requireUser();
  const safeData = sanitizeForFirestore(data);

  const ref = doc(db, "users", u.uid, "snapshots", "latest");
  await setDoc(ref, {
    id: "latest",
    label: String(label || "Snapshot"),
    data: safeData,
    // createdAt ne doit pas bouger après la 1ère création : merge = true
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return "latest";
}

// ✅ LISTE: on ne lit que "latest" (1 read)
export async function cloudListSnapshots(){
  const u = requireUser();
  const ref = doc(db, "users", u.uid, "snapshots", "latest");
  const snap = await getDoc(ref);
  if(!snap.exists()) return [];

  const x = snap.data() || {};
  return [{
    id: "latest",
    label: x.label || "Snapshot",
    updatedAt: x.updatedAt || null,
    createdAt: x.createdAt || null
  }];
}

export async function cloudLoadSnapshot(snapshotId="latest"){
  const u = requireUser();
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Snapshot introuvable.");
  return (snap.data()||{}).data;
}

// Option “supprimer” : marque deleted (garde la structure)
export async function cloudDeleteSnapshot(snapshotId="latest"){
  const u = requireUser();
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  await updateDoc(ref, { deleted:true, updatedAt: serverTimestamp() });
}

/* -------------------- COMPAT EXPORTS (pour éviter erreurs) -------------------- */

export async function requireAccessOrRedirect(...args){
  const mod = await import("./gate.js");
  return mod.requireAccessOrRedirect(...args);
}

export function exportLocalSnapshot(filename="snapshot_local.json"){
  return downloadJson(filename, getAllLocalStorage());
}

export function importLocalSnapshot(objOrJson, { clearFirst=false } = {}){
  return uploadJsonToLocalStorage(objOrJson, { clearFirst });
}







