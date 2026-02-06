import { db, fns } from "./db.js";
const { doc, setDoc, serverTimestamp } = fns;

export async function cloudSaveSnapshot(user, localStorageObject){
  const ref = doc(db, "users", user.uid, "tournaments", "snapshot");
  await setDoc(ref, {
    savedAt: Date.now(),
    updatedAtServer: serverTimestamp(),
    localStorage: localStorageObject
  }, { merge:true });
}
