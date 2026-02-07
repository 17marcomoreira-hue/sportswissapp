// js/storage.js
// Import/Export local + sauvegarde "snapshot" dans Firestore (cloud)

import { auth } from "./auth.js";
import { db, fns } from "./db.js";

const {
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, addDoc, query, orderBy, limit,
  serverTimestamp, Timestamp
} = fns;

/* -------------------- LOCAL -------------------- */

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
      }catch(e){
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

/* -------------------- CLOUD (Firestore) -------------------- */
/**
 * Stockage : users/{uid}/snapshots/{autoId}
 * Chaque snapshot contient :
 * - label (nom lisible)
 * - data (ton tournoi)
 * - createdAt / updatedAt
 */
function requireUser(){
  const u = auth.currentUser;
  if(!u) throw new Error("Non connecté.");
  return u;
}

function snapshotsColRef(uid){
  return collection(db, "users", uid, "snapshots");
}

// ✅ attendu par ton app
export async function cloudSaveSnapshot(data, label="Snapshot"){
  const u = requireUser();
  const col = snapshotsColRef(u.uid);

  const docRef = await addDoc(col, {
    label: String(label || "Snapshot"),
    data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return docRef.id;
}

export async function cloudListSnapshots(max=50){
  const u = requireUser();
  const col = snapshotsColRef(u.uid);
  const q = query(col, orderBy("updatedAt","desc"), limit(Math.max(1, Math.min(200, max))));
  const snap = await getDocs(q);

  return snap.docs.map(d => {
    const v = d.data() || {};
    return {
      id: d.id,
      label: v.label || "Snapshot",
      updatedAt: v.updatedAt || null,
      createdAt: v.createdAt || null
    };
  });
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
  // deleteDoc n'est pas dans db.js => on fait update "deleted" simple (soft delete)
  await updateDoc(ref, { deleted:true, updatedAt: serverTimestamp() });
}


