// js/storage.js — ULTRA COMPAT + Firestore-safe
// - Import/Export local (localStorage) + téléchargement JSON
// - Snapshots cloud (Firestore) avec nettoyage (sanitize) pour éviter UserImpl / objets non supportés
// - Exports "compat" pour éviter les erreurs d'imports (gate/admin/license)

import { auth } from "./auth.js";
import { db, fns } from "./db.js";

const {
  doc, getDoc, updateDoc,
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

export function downloadText(filename, text, mime="text/plain;charset=utf-8"){
  // ✅ Supporte aussi l'appel downloadText(text) (sans filename)
  if (text === undefined && filename !== undefined && typeof filename !== "string") {
    text = filename;
    filename = "export.txt";
  }

  const name = String(filename ?? "export.txt");
  const safeName = name.replace(/[^\w.\-]+/g, "_");

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

/* -------------------- FILE PICKER -------------------- */

export function readJsonFile(file){
  return new Promise((resolve, reject)=>{
    if(!file) return reject(new Error("Aucun fichier sélectionné."));
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error("Lecture du fichier impossible."));
    reader.onload = ()=>{
      try{ resolve(JSON.parse(String(reader.result || ""))); }
      catch{ reject(new Error("Fichier JSON invalide.")); }
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
      }catch(e){ reject(e); }
    };
    input.click();
  });
}

/* -------------------- LOCALSTORAGE SNAPSHOT -------------------- */

// ✅ export attendu: getAllLocalStorage
export function getAllLocalStorage(){
  const out = {};
  try{
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k==null) continue;
      out[k] = localStorage.getItem(k);
    }
  }catch{}
  return out;
}

export function setAllLocalStorage(obj, { clearFirst=false } = {}){
  try{
    if(clearFirst) localStorage.clear();
    if(!obj || typeof obj !== "object") return;
    for(const [k,v] of Object.entries(obj)){
      localStorage.setItem(String(k), String(v ?? ""));
    }
  }catch{}
}

// ✅ export attendu: uploadJsonToLocalStorage
export function uploadJsonToLocalStorage(jsonOrObject, { clearFirst=false } = {}){
  let obj = jsonOrObject;
  if(typeof obj === "string"){
    try{ obj = JSON.parse(obj); }
    catch{ throw new Error("JSON invalide (impossible à parser)."); }
  }
  if(!obj || typeof obj !== "object") throw new Error("Format invalide.");
  setAllLocalStorage(obj, { clearFirst });
  return true;
}

/* -------------------- CLOUD SNAPSHOTS (Firestore) -------------------- */

function requireUser(){
  const u = auth.currentUser;
  if(!u) throw new Error("Non connecté.");
  return u;
}

function snapshotsCol(uid){
  return collection(db, "users", uid, "snapshots");
}

/**
 * Nettoie n'importe quel objet "state" pour qu'il soit stockable dans Firestore :
 * - supprime fonctions / undefined
 * - convertit Date -> ISO string
 * - évite cycles
 * - réduit les objets "UserImpl" / user-like -> {uid,email,emailVerified}
 * - Map/Set/TypedArray -> tableaux
 */
function sanitizeForFirestore(value){
  const seen = new WeakSet();

  const walk = (v) => {
    if (v === null) return null;

    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;

    if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") return null;

    if (v instanceof Date) return v.toISOString();

    // Firebase user-like (UserImpl)
    if (v && typeof v === "object" && ("uid" in v) && ("email" in v || "emailVerified" in v)) {
      return {
        uid: v.uid ?? null,
        email: v.email ?? null,
        emailVerified: !!v.emailVerified
      };
    }

    // Map / Set
    if (v instanceof Map) return Array.from(v.entries()).map(([k,val]) => [walk(k), walk(val)]);
    if (v instanceof Set) return Array.from(v.values()).map(walk);

    // Typed arrays -> normal array
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v);

    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);

      if (Array.isArray(v)) return v.map(walk);

      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }

    return null;
  };

  return walk(value);
}

// ✅ export attendu: cloudSaveSnapshot
export async function cloudSaveSnapshot(data, label="Snapshot"){
  const u = requireUser();
  const safeData = sanitizeForFirestore(data);

  const ref = await addDoc(snapshotsCol(u.uid), {
    label: String(label || "Snapshot"),
    data: safeData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function cloudListSnapshots(max=50){
  const u = requireUser();
  const q = query(
    snapshotsCol(u.uid),
    orderBy("updatedAt","desc"),
    limit(Math.max(1, Math.min(200, max)))
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id:d.id, ...(d.data()||{}) }))
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
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("Snapshot introuvable.");
  return (snap.data()||{}).data;
}

export async function cloudDeleteSnapshot(snapshotId){
  const u = requireUser();
  const ref = doc(db, "users", u.uid, "snapshots", snapshotId);
  await updateDoc(ref, { deleted:true, updatedAt: serverTimestamp() });
}

/* -------------------- COMPAT EXPORTS (aliases) -------------------- */

// ✅ export attendu: requireAccessOrRedirect (en réalité dans gate.js)
export async function requireAccessOrRedirect(...args){
  const mod = await import("./gate.js");
  return mod.requireAccessOrRedirect(...args);
}

// ✅ alias pratique : export local snapshot
export function exportLocalSnapshot(filename="snapshot_local.json"){
  return downloadJson(filename, getAllLocalStorage());
}

// ✅ alias pratique : import local snapshot
export function importLocalSnapshot(objOrJson, { clearFirst=false } = {}){
  return uploadJsonToLocalStorage(objOrJson, { clearFirst });
}






