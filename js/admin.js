import { db, fns } from "./db.js";
import { waitForAuthReady, logout, resetPassword } from "./auth.js";
import { isAdminEmail } from "./license.js";

const {
  collection, doc, getDocs, query, where, orderBy, limit,
  setDoc, updateDoc, serverTimestamp
} = fns;

// ⚠️ Email admin
const ADMIN_EMAIL = "17marcomoreira@gmail.com";

const $ = (id) => document.getElementById(id);

const toDate = (v) => {
  if (!v) return null;
  if (typeof v === "number") return new Date(v);
  if (typeof v?.toDate === "function") return v.toDate();
  return new Date(v);
};
const fmt = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleString("fr-CH") : "—";
};
const now = () => Date.now();

function tag(text, kind = "") {
  const cls = kind ? `tag ${kind}` : "tag";
  return `<span class="${cls}">${text}</span>`;
}

function downloadCsv(filename, rows) {
  const esc = (v) => String(v ?? "").replaceAll('"', '""');
  const csv = rows.map(r => r.map(v => `"${esc(v)}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function addMonthsMillis(baseMillis, months) {
  const d = new Date(baseMillis);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d.getTime();
}

// ---------- UI ----------
function setMe(text) {
  const me = $("me");
  if (me) me.textContent = text;
}

function showGlobalError(e) {
  const msg = e?.message || String(e || "Erreur");
  console.error(e);

  const el = $("globalError");
  if (el) {
    el.textContent = msg;
    el.style.display = "block";
    return;
  }

  // Fallback si #globalError n’existe pas
  setMe(`Erreur: ${msg}`);
  alert(msg);
}

function clearGlobalError() {
  const el = $("globalError");
  if (el) {
    el.textContent = "";
    el.style.display = "none";
  }
}

// ---------- AUTH ----------
async function requireAdmin() {
  const auth = await waitForAuthReady();
  const user = auth.currentUser;

  // Pas connecté => redirection login
  if (!user) {
    setMe("Redirection vers la page de connexion…");
    location.href = "index.html?next=admin.html";
    throw new Error("Non connecté.");
  }

  // Connecté mais pas admin
  if (!isAdminEmail(user.email, ADMIN_EMAIL)) {
    setMe("Accès refusé. Redirection…");
    location.href = "index.html";
    throw new Error("Accès admin refusé.");
  }

  return user;
}

// ---------- USERS ----------
let usersCache = [];

function renderUsers(rows) {
  const tbody = $("usersTbody");
  if (!tbody) return;

  tbody.innerHTML = rows.map(u => {
    const lic = u.license || {};
    const licActive = !!(lic.active && lic.expiresAt && lic.expiresAt > now());

    const trialTotal = Number(u.trialSeconds || 0);
    const trialStart = Number(u.trialStartedAt || 0);
    const elapsed = trialStart ? Math.floor((now() - trialStart) / 1000) : 0;
    const remain = trialTotal ? Math.max(0, trialTotal - elapsed) : 0;

    const emailVerified = u.emailVerified ? tag("Oui", "ok") : tag("Non", "warn");
    const trialTag = remain > 0 ? tag(`${Math.ceil(remain / 60)} min`, "ok") : tag("Terminé", "bad");

    const licTag = licActive
      ? tag(`Active (${new Date(lic.expiresAt).toLocaleDateString("fr-CH")})`, "ok")
      : tag("Aucune", "muted");

    const device = u.activeDeviceId ? tag("Oui", "ok") : tag("—", "muted");

    return `
      <tr>
        <td>${u.email || "—"}</td>
        <td>${fmt(u.createdAt)}</td>
        <td>${fmt(u.lastLoginAt)}</td>
        <td>${emailVerified}</td>
        <td>${trialTag}</td>
        <td>${licTag}</td>
        <td>${device}</td>
        <td class="actions">
          <button class="btn small" data-act="reset" data-email="${u.email || ""}">Reset mdp</button>
          <button class="btn small" data-act="resend" data-uid="${u._id}">Renvoyer vérif.</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      try {
        clearGlobalError();
        btn.disabled = true;

        if (act === "reset") {
          const email = btn.dataset.email;
          if (!email) throw new Error("Email manquant.");
          await resetPassword(email);
          alert("Email de reset envoyé.");
        } else if (act === "resend") {
          const uid = btn.dataset.uid;
          if (!uid) throw new Error("UID manquant.");
          await updateDoc(doc(db, "users", uid), { adminResendVerify: true });
          alert("Ok. Le renvoi sera fait au prochain login.");
        }
      } catch (e) {
        showGlobalError(e);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function fetchUsers() {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(500)));
  usersCache = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  renderUsers(usersCache);
}

function applyUserFilter() {
  const q = ($("userSearch")?.value || "").trim().toLowerCase();
  if (!q) return renderUsers(usersCache);
  const filtered = usersCache.filter(u => (u.email || "").toLowerCase().includes(q));
  renderUsers(filtered);
}

function exportUsersCsv() {
  const rows = [[
    "email", "createdAt", "lastLoginAt", "emailVerified",
    "trialStartedAt", "trialSeconds", "license.active", "license.expiresAt", "activeDeviceId"
  ]];

  usersCache.forEach(u => {
    rows.push([
      u.email || "",
      fmt(u.createdAt),
      fmt(u.lastLoginAt),
      u.emailVerified ? "true" : "false",
      u.trialStartedAt ?? "",
      u.trialSeconds ?? "",
      u.license?.active ? "true" : "false",
      u.license?.expiresAt ?? "",
      u.activeDeviceId ?? ""
    ]);
  });

  downloadCsv("users.csv", rows);
}

// ---------- KEYS ----------
let keysCache = [];

function statusKey(k) {
  if (k.revoked) return { txt: "Révoquée", kind: "bad" };
  if (k.usedBy) return { txt: "Utilisée", kind: "warn" };
  return { txt: "Disponible", kind: "ok" };
}

function renderKeys(rows) {
  const tbody = $("keysTbody");
  if (!tbody) return;

  tbody.innerHTML = rows.map(k => {
    const st = statusKey(k);
    const linked = k.usedEmail || (k.usedBy ? k.usedBy.slice(0, 8) + "…" : "—");

    return `
      <tr>
        <td class="mono">${k.key || k._id}</td>
        <td>${tag(st.txt, st.kind)}</td>
        <td>${k.months ? `${k.months} mois` : "—"}</td>
        <td>${linked}</td>
        <td>${fmt(k.createdAt)}</td>
        <td class="actions">
          <button class="btn small" data-act="revoke" data-id="${k._id}">Révoquer</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      const id = btn.dataset.id;

      try {
        clearGlobalError();
        btn.disabled = true;

        if (act === "revoke") {
          if (!id) throw new Error("ID manquant.");
          await updateDoc(doc(db, "licenseKeys", id), { revoked: true });
          await fetchKeys();
        }
      } catch (e) {
        showGlobalError(e);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function fetchKeys() {
  const snap = await getDocs(query(collection(db, "licenseKeys"), orderBy("createdAt", "desc"), limit(1000)));
  keysCache = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  applyKeyFilter();
}

function applyKeyFilter() {
  const filter = $("keyFilter")?.value || "all";
  const q = ($("keySearch")?.value || "").trim().toLowerCase();

  let rows = [...keysCache];

  if (filter === "available") rows = rows.filter(k => !k.revoked && !k.usedBy);
  if (filter === "used") rows = rows.filter(k => !k.revoked && !!k.usedBy);
  if (filter === "revoked") rows = rows.filter(k => !!k.revoked);

  if (q) {
    rows = rows.filter(k =>
      String(k.key || k._id || "").toLowerCase().includes(q) ||
      String(k.usedEmail || "").toLowerCase().includes(q)
    );
  }

  renderKeys(rows);
}

function exportKeysCsv() {
  const rows = [["docId", "key", "months", "revoked", "usedBy", "usedEmail", "createdAt", "usedAt", "expiresAt"]];
  keysCache.forEach(k => {
    rows.push([
      k._id || "",
      k.key || "",
      k.months ?? "",
      k.revoked ? "true" : "false",
      k.usedBy ?? "",
      k.usedEmail ?? "",
      fmt(k.createdAt),
      fmt(k.usedAt),
      k.expiresAt ?? ""
    ]);
  });
  downloadCsv("licenseKeys.csv", rows);
}

// ---------- KEY GENERATION (docId = clé) ----------
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const part = (len) => Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
const makeKey = () => `${part(4)}-${part(4)}-${part(4)}`;

async function generateKeys(count, months) {
  const n = Math.max(1, Math.min(500, Number(count || 1)));
  const m = Number(months || 12);

  for (let i = 0; i < n; i++) {
    const key = makeKey();
    await setDoc(doc(db, "licenseKeys", key), {
      key,
      months: m,
      revoked: false,
      createdAt: serverTimestamp(),
      usedBy: null,
      usedEmail: null,
      usedAt: null,
      expiresAt: null
    });
  }
}

// ---------- MANUAL LICENSE (sans clé) ----------
async function grantManual(email, months) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("Email requis.");

  const snap = await getDocs(query(collection(db, "users"), where("email", "==", e), limit(1)));
  if (snap.empty) throw new Error("Utilisateur introuvable (il doit s'être connecté au moins une fois).");

  const uid = snap.docs[0].id;
  const m = Number(months || 12);
  const expiresAt = addMonthsMillis(now(), m);

  await updateDoc(doc(db, "users", uid), {
    license: { active: true, key: "MANUAL", expiresAt, status: "active" },
    licenseActivatedAt: serverTimestamp(),
    lastValidatedAt: now()
  });
}

// ---------- INIT ----------
(async function () {
  try {
    clearGlobalError();
    setMe("Chargement…");

    const user = await requireAdmin();
    setMe(`Connecté en admin : ${user.email}`);

    // Logout
    $("btnLogout")?.addEventListener("click", async () => {
      try {
        await logout();
        location.href = "index.html";
      } catch (e) {
        showGlobalError(e);
      }
    });

    // Users
    $("btnRefreshUsers")?.addEventListener("click", async () => {
      try { clearGlobalError(); await fetchUsers(); }
      catch (e) { showGlobalError(e); }
    });
    $("btnExportUsersCsv")?.addEventListener("click", () => {
      try { exportUsersCsv(); } catch (e) { showGlobalError(e); }
    });
    $("userSearch")?.addEventListener("input", applyUserFilter);

    // Keys
    $("btnRefreshKeys")?.addEventListener("click", async () => {
      try { clearGlobalError(); await fetchKeys(); }
      catch (e) { showGlobalError(e); }
    });
    $("btnExportKeysCsv")?.addEventListener("click", () => {
      try { exportKeysCsv(); } catch (e) { showGlobalError(e); }
    });
    $("keyFilter")?.addEventListener("change", applyKeyFilter);
    $("keySearch")?.addEventListener("input", applyKeyFilter);

    $("btnGenKeys")?.addEventListener("click", async () => {
      const count = Number($("genCount")?.value || 10);
      const months = Number($("genMonths")?.value || 12);

      try {
        clearGlobalError();
        $("btnGenKeys").disabled = true;
        await generateKeys(count, months);
        await fetchKeys();
        alert(`${count} clés générées (${months} mois).`);
      } catch (e) {
        showGlobalError(e);
      } finally {
        $("btnGenKeys").disabled = false;
      }
    });

    // Manual
    $("btnManual12")?.addEventListener("click", async () => {
      try {
        clearGlobalError();
        const email = $("manualEmail")?.value || "";
        $("btnManual12").disabled = true;
        await grantManual(email, 12);
        alert("Licence activée 12 mois.");
        await fetchUsers();
      } catch (e) {
        showGlobalError(e);
      } finally {
        $("btnManual12").disabled = false;
      }
    });

    $("btnManualExtend12")?.addEventListener("click", async () => {
      try {
        clearGlobalError();
        const email = $("manualEmail")?.value || "";
        $("btnManualExtend12").disabled = true;
        await grantManual(email, 12);
        alert("Licence prolongée 12 mois.");
        await fetchUsers();
      } catch (e) {
        showGlobalError(e);
      } finally {
        $("btnManualExtend12").disabled = false;
      }
    });

    // Initial load
    await fetchUsers();
    await fetchKeys();

    // Retire un éventuel placeholder
    const loading = document.querySelector("[data-loading]");
    if (loading) loading.remove();

  } catch (e) {
    showGlobalError(e);
  }
})();



