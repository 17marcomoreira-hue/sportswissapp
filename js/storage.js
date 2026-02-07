// js/storage.js
// Utilitaires : import/export localStorage + téléchargement + snapshots cloud (Firestore)
// + exports "compat" attendus par d'autres fichiers (gate/admin/license)

import { auth } from "./auth.js";
import { db, fns } from "./db.js";

const {
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, addDoc, query, orderBy, limit,
  serverTimestamp
} = fns;

/* -------------------- LOCAL: téléchargement fichiers -------------------- */

export function downloadJson(filename, data){
  const safeName = (filename || "export.json").replace(/[^\w.\-]+/g, "_");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

export function downloadText(filename, text, mime="text/plain;charset=utf-8"){
  const safeName = (filename || "export.txt").replace(/[^\w.\-]+/g, "_");
  const blob = new Blob([String(text ?? "")], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

export function readJsonFile(file){
  return new Promise((resolve, reject)=>{
    if(!file) return reject(new Error("Aucun fichier sélectionné."));
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error("Lecture du fichier impossible."));
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(String(reader.result || ""));
        resolve(obj);
      }catch{
        reject(new Error("Fichier JSON invalide."));
      }
    };
    reader.readAsText(file, "utf-8");
  });
}

export async function pickAndReadJson(){
  return new Promise((resolve, reject)=>{
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async ()=>{
      try{
        const file = input.files?.[0];
        const obj = await readJsonFile(file);
        resolve({ file, obj });
      }catch(e){
        reject(e);
      }
    };
    input.click();
  });
}

/* -------------------- LOCAL: localStorage helpers -------------------- */

// ✅ Export attendu : getAllLocalStorage
export function getAllLocalStorage(){
  const out = {};
  try{
    for(let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if(k == null) continue;
      out[k] = localStorage.getItem(k);
    }
  }catch(e){
    // localStorage indisponible (mode privé strict, etc.)
  }
  return out;
}

// Utile pour importer un snapshot local complet
export function setAllLocalStorage(obj, { clearFirst=false } = {}){
  try{
    if(clearFirst) localStorage.clear();
    if(!obj || typeof obj !== "object") return;
    for(const [k,v] of Object.entries(obj)){
      if(typeof k !== "string") continue;
      localStorage.setItem(k, String(v ?? ""));
    }
  }catch(e){
    // ignore
  }
}

// Option: exporter uniquement une clé (si ton app stocke un gros JSON sous une clé)
export function getLocalStorageItem(key, fallback=null){
  try{
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  }catch{
    return fallback;
  }
}

export function setLocalStorageItem(key, value){
  try{ localStorage.setItem(key, String(value ?? "")); }catch{}
}

/* -------------------- CLOUD: snapshots Firestore -------------------- */
/**
 * Chemin: users/{uid}/snapshots/{autoId}
 * - label: nom lisible
 * - data : objet tournoi (ou snapshot localStorage)
 */

function requireUser(){
  const u = auth.currentUser;
  if(!u) throw new Error("Non connecté.");
  return u;
}
function snapshotsColRef(uid){
  return collection(db, "users", uid, "snapshots");
}

// ✅ Export attendu : cloudSaveSnapshot (ton app l’importe)
export async function cloudSaveSnapshot(data, label="Snapshot"){
  const u = requireUser();
  const col = snapshotsColRef(u.uid);

  const ref = await addDoc(col, {
    label: String(label || "Snapshot"),
    data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function cloudListSnapshots(max=50){
  const u = requireUser();
  const col = snapshotsColRef(u.uid);
  const q = query(col, orderBy("updatedAt","desc"), limit(Math.max(1, Math.min(200, max))));
  const snap = await getDocs(q);

  return snap.docs
    .map(d => ({ id: d.id, ...(d.data()||{}) }))
    .filter(x => !x.deleted)
    .map(x => ({
      id: x.id,
      label: x.label || "Snapshot",
      updatedAt: x.updatedAt || null,
      createdAt: x.createdAt || null
    }));
}

export async function cloudLoadSnapshot(snapshotId){
  const u = requireUser();
  if(!snapshotId) throw new Error("Snapshot ID manquant.");
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Snapshot introuvable.");
  const v = snap.data() || {};
  return v.data;
}

export async function cloudDeleteSnapshot(snapshotId){
  const u = requireUser();
  if(!snapshotId) throw new Error("Snapshot ID manquant.");
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  await updateDoc(ref, { deleted:true, updatedAt: serverTimestamp() });
}

/* -------------------- COMPAT exports (pour éviter les imports cassés) -------------------- */

// ✅ Certains fichiers importaient requireAccessOrRedirect depuis storage.js.
// On le ré-expose ici en déléguant à gate.js.
export async function requireAccessOrRedirect(...args){
  const mod = await import("./gate.js");
  return mod.requireAccessOrRedirect(...args);
}



