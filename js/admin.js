import { db, fns } from "./db.js";
import { waitForAuthReady, logout, resetPassword } from "./auth.js";
import { isAdminEmail } from "./license.js";

const {
  collection, doc, getDocs, query, where, orderBy, limit,
  addDoc, updateDoc, serverTimestamp
} = fns;

// ⚠️ Mets ici ton email admin
const ADMIN_EMAIL = "17marcomoreira@gmail.com";

const $ = (id)=>document.getElementById(id);

const toDate = (v)=>{
  if(!v) return null;
  if(typeof v === "number") return new Date(v);
  if(v.toDate) return v.toDate();
  return new Date(v);
};
const fmt = (v)=>{
  const d = toDate(v);
  return d ? d.toLocaleString("fr-CH") : "—";
};
const now = ()=>Date.now();

function tag(text, kind=""){
  const cls = kind ? `tag ${kind}` : "tag";
  return `<span class="${cls}">${text}</span>`;
}

function downloadCsv(filename, rows){
  const esc = (v)=>String(v ?? "").replaceAll('"','""');
  const csv = rows.map(r => r.map(v=>`"${esc(v)}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function addMonths(tsMillis, months){
  const d = new Date(tsMillis);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/* -------------------- GUARD -------------------- */
async function guard(){
  const user = await waitForAuthReady();
  if(!user){ location.href = "./login.html"; return null; }

  if(!isAdminEmail(user.email, ADMIN_EMAIL)){
    alert("Accès admin refusé.");
    location.href = "./app.html";
    return null;
  }

  $("me").textContent = `Connecté en admin : ${user.email}`;
  return user;
}

/* -------------------- USERS -------------------- */
let usersCache = [];

function computeTrial(profile){
  const started = Number(profile?.trialStartedAt || 0);
  const total = Number(profile?.trialSeconds || 0);
  if(!started || !total) return { label:"—" };
  const endsAt = started + total*1000;
  const active = endsAt > now();
  return { label: active ? "Actif" : "Expiré", kind: active ? "ok" : "bad", endsAt };
}

function computeLicense(profile){
  const exp = Number(profile?.license?.expiresAt || 0);
  if(!exp) return { label:"—" };
  const active = !!(profile?.license?.active && exp > now());
  return { label: active ? "Active" : "Expirée", kind: active ? "ok" : "bad", expiresAt: exp, key: profile?.license?.key || "" };
}

function deviceInfo(profile){
  const id = profile?.activeDeviceId || "";
  if(!id) return { label:"—" };
  return { label: `${id.slice(0,8)}…`, last: profile?.lastDeviceAt || null };
}

async function fetchUsers(){
  const qy = query(collection(db,"users"), orderBy("createdAt","desc"), limit(500));
  const snap = await getDocs(qy);
  usersCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderUsers();
}

function renderUsers(){
  const q = $("userSearch").value.trim().toLowerCase();
  const list = q ? usersCache.filter(u => (u.email||"").toLowerCase().includes(q)) : usersCache;
  const tbody = $("usersTbody");

  tbody.innerHTML = list.map(u => {
    const verified = u.emailVerified ? tag("Oui","ok") : tag("Non","warn");

    const trial = computeTrial(u);
    const trialHtml = trial.endsAt
      ? `${tag(trial.label, trial.kind)}<div class="small">fin: ${new Date(trial.endsAt).toLocaleString("fr-CH")}</div>`
      : "—";

    const lic = computeLicense(u);
    const licHtml = lic.expiresAt
      ? `${tag(lic.label, lic.kind)}<div class="small">fin: ${new Date(lic.expiresAt).toLocaleString("fr-CH")}</div>`
      : "—";

    const dev = deviceInfo(u);
    const devHtml = dev.label === "—" ? "—" : `${tag(dev.label)}<div class="small">refresh: ${fmt(dev.last)}</div>`;

    return `
      <tr>
        <td>
          <div style="font-weight:1000">${u.email || "—"}</div>
          <div class="small mono">uid: ${u.uid || u.id}</div>
        </td>
        <td>${fmt(u.createdAt)}</td>
        <td>${fmt(u.lastLoginAt)}</td>
        <td>${verified}</td>
        <td>${trialHtml}</td>
        <td>${licHtml}</td>
        <td>${devHtml}</td>
        <td>
          <div class="row">
            <button class="btn2" data-act="resetDevice" data-uid="${u.uid || u.id}">Reset appareil</button>
            <button class="btn2" data-act="askVerify" data-uid="${u.uid || u.id}">Renvoyer vérif.</button>
            <button class="btn2" data-act="resetPass" data-email="${u.email || ""}">Reset mdp</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const act = btn.getAttribute("data-act");
      const uid = btn.getAttribute("data-uid");
      const email = btn.getAttribute("data-email");
      try{
        if(act === "resetDevice"){
          await updateDoc(doc(db,"users",uid), { activeDeviceId:null, lastDeviceAt: serverTimestamp(), updatedAt: serverTimestamp() });
          await fetchUsers();
          alert("Session appareil réinitialisée.");
        }
        if(act === "askVerify"){
          await updateDoc(doc(db,"users",uid), { adminResendVerify:true, updatedAt: serverTimestamp() });
          alert("Demande enregistrée. L’email partira au prochain login de l’utilisateur.");
        }
        if(act === "resetPass"){
          if(!email) return alert("Email manquant");
          await resetPassword(email);
          alert("Email de réinitialisation envoyé (l’utilisateur doit vérifier aussi ses spams).");
        }
      }catch(e){
        alert(e?.message || "Erreur action admin");
      }
    });
  });
}

/* -------------------- KEYS (licenseKeys) -------------------- */
let keysCache = [];

function keyStatus(k){
  if(k.revoked) return { label:"Révoquée", kind:"bad" };
  if(k.usedBy){
    const exp = Number(k.expiresAt || 0);
    if(exp && exp < now()) return { label:"Expirée", kind:"bad" };
    return { label:"Utilisée", kind:"warn" };
  }
  return { label:"Disponible", kind:"ok" };
}

async function fetchKeys(){
  const snap = await getDocs(query(collection(db,"licenseKeys"), orderBy("createdAt","desc"), limit(1500)));
  keysCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderKeys();
}

function renderKeys(){
  const filter = $("keyFilter").value;
  const q = $("keySearch").value.trim().toLowerCase();

  let list = keysCache.slice();

  if(filter !== "all"){
    list = list.filter(k=>{
      const st = keyStatus(k).label.toLowerCase();
      if(filter === "available") return st.includes("disponible");
      if(filter === "used") return st.includes("utilisée") || st.includes("utilisee");
      if(filter === "revoked") return st.includes("révoquée") || st.includes("revoquee");
      if(filter === "expired") return st.includes("expirée") || st.includes("expiree");
      return true;
    });
  }

  if(q){
    list = list.filter(k=>{
      const s = `${k.key||""} ${k.usedEmail||""} ${k.usedBy||""}`.toLowerCase();
      return s.includes(q);
    });
  }

  const tbody = $("keysTbody");
  tbody.innerHTML = list.map(k=>{
    const st = keyStatus(k);
    const who = k.usedEmail
      ? `<div style="font-weight:900">${k.usedEmail}</div><div class="small mono">${String(k.usedBy||"").slice(0,10)}…</div>`
      : "—";

    return `
      <tr>
        <td class="mono">${k.key || "—"}</td>
        <td>${tag(st.label, st.kind)}</td>
        <td>${k.months || 12} mois</td>
        <td>${who}</td>
        <td>${fmt(k.createdAt)}</td>
        <td>${k.revoked ? "—" : `<button class="btnDanger" data-act="revokeKey" data-id="${k.id}">Révoquer</button>`}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button[data-act='revokeKey']").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-id");
      if(!confirm("Révoquer cette clé ?")) return;
      await updateDoc(doc(db,"licenseKeys",id), { revoked:true, revokedAt: serverTimestamp() });
      await fetchKeys();
    });
  });
}

function makeKey(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n)=>Array.from({length:n},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  return `${part(4)}-${part(4)}-${part(4)}`;
}

async function generateKeys(count, months){
  const n = Math.max(1, Math.min(500, Number(count||1)));
  const m = Number(months||12);

  for(let i=0;i<n;i++){
    const key = makeKey();
    await addDoc(collection(db,"licenseKeys"), {
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
  if(!u) throw new Error("Utilisateur introuvable (il doit s’être connecté au moins une fois).");

  const uid = u.uid || u.id;
  const currentEnd = Number(u?.license?.expiresAt || 0);
  const base = (mode === "extend" && currentEnd > now()) ? currentEnd : now();
  const newEnd = addMonths(base, 12);

  await updateDoc(doc(db,"users",uid), {
    license: { active:true, key:"MANUAL", expiresAt: newEnd },
    lastValidatedAt: now(),
    updatedAt: serverTimestamp()
  });
}

async function revokeLicense(email){
  const u = await findUserByEmail(email);
  if(!u) throw new Error("Utilisateur introuvable.");
  const uid = u.uid || u.id;
  await updateDoc(doc(db,"users",uid), {
    license: { active:false, key:null, expiresAt: null },
    updatedAt: serverTimestamp()
  });
}

/* -------------------- INIT -------------------- */
await guard();

$("btnLogout").onclick = async ()=>{ await logout(); location.href = "./login.html"; };

$("btnRefreshUsers").onclick = fetchUsers;
$("userSearch").addEventListener("input", renderUsers);
$("btnExportUsersCsv").onclick = ()=>{
  const rows = [[
    "email","uid","createdAt","lastLoginAt","emailVerified","trialStartedAt","trialSeconds","licenseActive","licenseExpiresAt","licenseKey","activeDeviceId","lastDeviceAt","lastValidatedAt"
  ]];

  for(const u of usersCache){
    rows.push([
      u.email||"",
      u.uid||u.id||"",
      fmt(u.createdAt),
      fmt(u.lastLoginAt),
      u.emailVerified ? "true" : "false",
      u.trialStartedAt || "",
      u.trialSeconds || "",
      u?.license?.active ? "true" : "false",
      u?.license?.expiresAt || "",
      u?.license?.key || "",
      u.activeDeviceId || "",
      fmt(u.lastDeviceAt),
      u.lastValidatedAt || ""
    ]);
  }
  downloadCsv("users.csv", rows);
};

$("btnGenKeys").onclick = async ()=>{
  const count = $("genCount").value;
  const months = $("genMonths").value;
  $("btnGenKeys").disabled = true;
  try{
    await generateKeys(count, months);
    await fetchKeys();
    alert("Clés générées.");
  }finally{
    $("btnGenKeys").disabled = false;
  }
};

$("btnRefreshKeys").onclick = fetchKeys;
$("keyFilter").addEventListener("change", renderKeys);
$("keySearch").addEventListener("input", renderKeys);
$("btnExportKeysCsv").onclick = ()=>{
  const rows = [["key","status","months","usedEmail","usedBy","usedAt","expiresAt","revoked","createdAt"]];
  for(const k of keysCache){
    const st = keyStatus(k).label;
    rows.push([
      k.key||"",
      st,
      String(k.months||12),
      k.usedEmail||"",
      k.usedBy||"",
      fmt(k.usedAt),
      k.expiresAt||"",
      k.revoked ? "true" : "false",
      fmt(k.createdAt)
    ]);
  }
  downloadCsv("keys.csv", rows);
};

$("btnGrant12").onclick = async ()=>{
  const email = $("manualEmail").value.trim();
  if(!email) return alert("Entre un email.");
  await grantLicense(email, "grant");
  await fetchUsers();
  alert("Licence activée 12 mois.");
};

$("btnExtend12").onclick = async ()=>{
  const email = $("manualEmail").value.trim();
  if(!email) return alert("Entre un email.");
  await grantLicense(email, "extend");
  await fetchUsers();
  alert("Licence prolongée 12 mois.");
};

$("btnRevoke").onclick = async ()=>{
  const email = $("manualEmail").value.trim();
  if(!email) return alert("Entre un email.");
  if(!confirm("Révoquer la licence de cet utilisateur ?")) return;
  await revokeLicense(email);
  await fetchUsers();
  alert("Licence révoquée.");
};

await fetchUsers();
await fetchKeys();
