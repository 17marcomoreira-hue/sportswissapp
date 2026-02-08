import { db, fns } from "./db.js";
import { waitForAuthReady, logout, resetPassword } from "./auth.js";
import { isAdminEmail } from "./license.js";

const {
  collection, doc, getDocs, query, where, orderBy, limit,
  setDoc, updateDoc, serverTimestamp
} = fns;

// ⚠️ Mets ici ton email admin
const ADMIN_EMAIL = "17marcomoreira@gmail.com";

const $ = (id)=>document.getElementById(id);

const toDateTime = (t)=>{
  if(!t) return "";
  try{
    // Firestore Timestamp -> Date
    if(typeof t.toDate === "function") return t.toDate().toLocaleString();
    // millis -> Date
    if(typeof t === "number") return new Date(t).toLocaleString();
    return String(t);
  }catch{ return String(t); }
};

function msg(el, text, ok=true){
  if(!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#2e7d32" : "#c62828";
}

function sanitizeEmail(v){
  return String(v||"").trim().toLowerCase();
}

function safeTrimUpper(v){
  return String(v||"").trim().toUpperCase();
}

/* -------------------- UI HELPERS -------------------- */
function setDisabled(btn, yes){
  if(!btn) return;
  btn.disabled = !!yes;
  btn.style.opacity = yes ? 0.6 : 1;
  btn.style.cursor = yes ? "not-allowed" : "pointer";
}

/* -------------------- KEY GENERATION -------------------- */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const part = (len)=>Array.from({length:len},()=>CHARS[Math.floor(Math.random()*CHARS.length)]).join("");
const makeKey = ()=>`${part(4)}-${part(4)}-${part(4)}`;

/* -------------------- KEYS (licenseKeys) -------------------- */
async function fetchKeys(limitN=200){
  const keysEl = $("keysList");
  if(keysEl) keysEl.textContent = "Chargement...";

  const snap = await getDocs(
    query(
      collection(db,"licenseKeys"),
      orderBy("createdAt","desc"),
      limit(Math.max(1, Math.min(1000, Number(limitN||200))))
    )
  );

  if(!keysEl) return;
  if(snap.empty){
    keysEl.textContent = "Aucune clé.";
    return;
  }

  const rows = [];
  snap.forEach(d=>{
    const v = d.data();
    rows.push({
      id: d.id,
      key: v.key || d.id,
      months: v.months ?? "",
      revoked: !!v.revoked,
      usedBy: v.usedBy || "",
      usedEmail: v.usedEmail || "",
      usedAt: toDateTime(v.usedAt),
      expiresAt: v.expiresAt ? toDateTime(v.expiresAt) : "",
      createdAt: toDateTime(v.createdAt),
    });
  });

  keysEl.textContent = rows.map(r=>{
    const status = r.revoked ? "❌ révoquée" : (r.usedBy ? "✅ utilisée" : "🟦 dispo");
    return [
      `${r.key}  (${status})`,
      `  mois: ${r.months}`,
      r.usedEmail ? `  email: ${r.usedEmail}` : "",
      r.usedAt ? `  utilisée: ${r.usedAt}` : "",
      r.expiresAt ? `  expire: ${r.expiresAt}` : "",
      r.createdAt ? `  créée: ${r.createdAt}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

// ✅ NOUVELLE VERSION : docId = la clé (IMPORTANT)
async function generateKeys(count, months){
  const n = Math.max(1, Math.min(500, Number(count||1)));
  const m = Number(months||12);

  for(let i=0;i<n;i++){
    const key = makeKey();

    // docId = key (IMPORTANT)
    await setDoc(doc(db,"licenseKeys", key), {
      key,
      months: m,
      revoked:false,
      createdAt: serverTimestamp(),
      usedBy: null,
      usedEmail: null,
      usedAt: null,
      expiresAt: null
    });
  }
}

/* -------------------- MANUAL LICENSE -------------------- */
async function findUserByEmail(email){
  const snap = await getDocs(query(collection(db,"users"), where("email","==",email), limit(1)));
  if(snap.empty) return null;
  const d = snap.docs[0];
  return { id:d.id, ...d.data() };
}

async function grantLicense(email, mode){
  const u = await findUserByEmail(email);
  if(!u) throw new Error("Utilisateur introuvable.");

  const now = Date.now();
  let expiresAt = null;

  if(mode === "1y"){
    const d = new Date(now);
    d.setFullYear(d.getFullYear()+1);
    expiresAt = d.getTime();
  }else if(mode === "6m"){
    const d = new Date(now);
    d.setMonth(d.getMonth()+6);
    expiresAt = d.getTime();
  }else if(mode === "1m"){
    const d = new Date(now);
    d.setMonth(d.getMonth()+1);
    expiresAt = d.getTime();
  }else{
    throw new Error("Mode invalide.");
  }

  await updateDoc(doc(db,"users", u.id), {
    license: { active:true, key:"MANUAL", expiresAt, status:"active" },
    licenseActivatedAt: serverTimestamp(),
    lastValidatedAt: now,
  });

  return { uid:u.id, expiresAt };
}

/* -------------------- PASSWORD RESET -------------------- */
async function doReset(email){
  await resetPassword(email);
}

/* -------------------- MAIN -------------------- */
(async function init(){
  const infoEl = $("adminInfo");
  const errEl  = $("adminError");
  const okEl   = $("adminOk");

  msg(errEl, "");
  msg(okEl, "");

  const auth = await waitForAuthReady();
  const user = auth.currentUser;

  if(!user){
    msg(errEl, "Non connecté.", false);
    return;
  }

  if(!isAdminEmail(user.email, ADMIN_EMAIL)){
    msg(errEl, "Accès refusé (admin uniquement).", false);
    return;
  }

  if(infoEl) infoEl.textContent = `Connecté en admin : ${user.email}`;

  // Boutons
  const btnLogout = $("btnLogout");
  if(btnLogout){
    btnLogout.addEventListener("click", async ()=>{
      try{ await logout(); location.href = "index.html"; }
      catch(e){ msg(errEl, e?.message||"Erreur logout", false); }
    });
  }

  // Refresh keys
  const btnRefresh = $("btnRefreshKeys");
  if(btnRefresh){
    btnRefresh.addEventListener("click", async ()=>{
      try{
        msg(errEl,""); msg(okEl,"");
        setDisabled(btnRefresh, true);
        await fetchKeys();
        msg(okEl, "Clés rafraîchies.", true);
      }catch(e){
        msg(errEl, e?.message||"Erreur refresh keys", false);
        console.error(e);
      }finally{
        setDisabled(btnRefresh, false);
      }
    });
  }

  // Generate keys
  const btnGen = $("btnGenerateKeys");
  if(btnGen){
    btnGen.addEventListener("click", async ()=>{
      const n = Number($("genCount")?.value || 10);
      const m = Number($("genMonths")?.value || 12);

      try{
        msg(errEl,""); msg(okEl,"");
        setDisabled(btnGen, true);
        await generateKeys(n, m);
        await fetchKeys();
        msg(okEl, `${n} clés générées (${m} mois).`, true);
      }catch(e){
        msg(errEl, e?.message||"Erreur génération clés", false);
        console.error(e);
      }finally{
        setDisabled(btnGen, false);
      }
    });
  }

  // Manual grant
  const btnGrant = $("btnGrant");
  if(btnGrant){
    btnGrant.addEventListener("click", async ()=>{
      const email = sanitizeEmail($("grantEmail")?.value);
      const mode  = $("grantMode")?.value || "1y";
      try{
        msg(errEl,""); msg(okEl,"");
        if(!email) throw new Error("Email requis.");
        setDisabled(btnGrant, true);
        const r = await grantLicense(email, mode);
        msg(okEl, `Licence accordée à ${email} (expire: ${new Date(r.expiresAt).toLocaleString()})`, true);
      }catch(e){
        msg(errEl, e?.message||"Erreur grant", false);
        console.error(e);
      }finally{
        setDisabled(btnGrant, false);
      }
    });
  }

  // Reset password
  const btnReset = $("btnResetPwd");
  if(btnReset){
    btnReset.addEventListener("click", async ()=>{
      const email = sanitizeEmail($("resetEmail")?.value);
      try{
        msg(errEl,""); msg(okEl,"");
        if(!email) throw new Error("Email requis.");
        setDisabled(btnReset, true);
        await doReset(email);
        msg(okEl, `Email de réinitialisation envoyé à ${email}`, true);
      }catch(e){
        msg(errEl, e?.message||"Erreur reset", false);
        console.error(e);
      }finally{
        setDisabled(btnReset, false);
      }
    });
  }

  // Auto-load keys on admin open
  try{
    await fetchKeys();
  }catch(e){
    msg(errEl, e?.message||"Erreur chargement clés", false);
    console.error(e);
  }
})();
