// js/storage.js
// Utilitaires simples pour import/export JSON (local) + téléchargement fichier

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

/**
 * Ouvre une boîte de dialogue de sélection de fichier (JSON) et renvoie l'objet parsé.
 */
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

