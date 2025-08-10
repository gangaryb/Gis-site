// --- Config + API wrapper (MeshHubOS Lite) ---
let CFG = { API_BASE: "" };
let accessToken = null;

async function loadConfig() {
  try {
    const r = await fetch("./assets/config.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Missing assets/config.json");
    CFG = await r.json();
  } catch (e) {
    console.warn("Config load failed:", e.message);
  }
}

// Get short-lived token (no hardcoded keys in the browser!)
async function getToken() {
  const r = await fetch(`${CFG.API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "anon" })
  });
  if (!r.ok) throw new Error("Auth failed");
  const data = await r.json();
  accessToken = data.token; // expires in ~5–15 min on the server
  if (data.expires_in) setTimeout(() => (accessToken = null), Math.max(1, data.expires_in - 5) * 1000);
}

async function api(path, opts = {}) {
  if (!accessToken) await getToken();
  const r = await fetch(`${CFG.API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      ...(opts.headers || {})
    }
  });
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

// Example: invoke an agent from a button
async function runProtoKernelDemo(payload) {
  try {
    const res = await api("/agents/invoke", {
      method: "POST",
      body: JSON.stringify({ agent: "proto-kernel-lite", input: payload })
    });
    return res; // { taskId, result?, status }
  } catch (e) {
    console.error(e);
    return { error: "Service temporarily unavailable. Please try again." };
  }
}

// Example: queue a task and poll
async function queueComplianceAudit(form) {
  const task = await api("/tasks", {
    method: "POST",
    body: JSON.stringify({
      kind: "compliance_audit",
      data: Object.fromEntries(new FormData(form))
    })
  });
  const id = task.id;
  let tries = 0;
  while (tries++ < 30) {
    const s = await api(`/tasks/${id}`, { method: "GET" });
    if (s.status === "done") return s;
    if (s.status === "error") throw new Error(s.error);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Timeout");
}

// Optional: live logs via SSE
function subscribeEvents(taskId, onMsg) {
  if (!accessToken) return;
  const es = new EventSource(`${CFG.API_BASE}/events/stream?task=${taskId}&token=${accessToken}`);
  es.onmessage = (ev) => onMsg(JSON.parse(ev.data));
  es.onerror = () => es.close();
  return () => es.close();
}

// --- UI niceties ---
function onIntersectReveal() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("show");
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
}

function smoothAnchorScroll() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href").slice(1);
    const el = document.getElementById(id);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
}

// --- Boot ---
(async () => {
  onIntersectReveal();
  smoothAnchorScroll();
  await loadConfig();

  const demoBtn = document.querySelector("#demoBtn");
  if (demoBtn) demoBtn.addEventListener("click", async () => {
    demoBtn.disabled = true;
    demoBtn.textContent = "Running…";
    const out = await runProtoKernelDemo({ prompt: "Hello MeshHubOS Lite" });
    document.querySelector("#demoOut").textContent = JSON.stringify(out, null, 2);
    demoBtn.textContent = "Run ProtoKernel Demo";
    demoBtn.disabled = false;
  });

  const auditForm = document.querySelector("#auditForm");
  if (auditForm) auditForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pre = document.querySelector("#auditOut");
    pre.textContent = "Queuing task…";
    try {
      const res = await queueComplianceAudit(auditForm);
      pre.textContent = JSON.stringify(res, null, 2);
    } catch (err) {
      pre.textContent = `Error: ${err.message}`;
    }
  });
})();
// ---------- Compliance GPT (frontend) ----------
const CGPT = {
  FREE_LIMIT: 3,                 // daily free questions (client-side hint; enforce server-side too)
  KEY: "cgpt_free_quota_v1",     // localStorage key
  THREAD_KEY: "cgpt_thread_id",  // optional thread id preservation
};

function dayKey() {
  const d = new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
}
function getQuota() {
  const raw = localStorage.getItem(CGPT.KEY);
  const today = dayKey();
  if (!raw) { localStorage.setItem(CGPT.KEY, JSON.stringify({ day: today, used: 0 })); return { used: 0, day: today }; }
  const obj = JSON.parse(raw);
  if (obj.day !== today) { localStorage.setItem(CGPT.KEY, JSON.stringify({ day: today, used: 0 })); return { used: 0, day: today }; }
  return obj;
}
function useQuota() {
  const obj = getQuota(); obj.used = (obj.used || 0) + 1;
  localStorage.setItem(CGPT.KEY, JSON.stringify(obj));
  return obj.used;
}
function setThread(id){ localStorage.setItem(CGPT.THREAD_KEY, id); }
function getThread(){ return localStorage.getItem(CGPT.THREAD_KEY) || null; }

function renderMsg(win, role, text) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const who = document.createElement("div");
  who.className = "role";
  who.textContent = role === "user" ? "You" : "GIS";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(who); row.appendChild(bubble);
  win.appendChild(row);
  win.scrollTop = win.scrollHeight;
}

function setCounter(el) {
  const q = getQuota();
  const left = Math.max(0, CGPT.FREE_LIMIT - (q.used || 0));
  el.textContent = `${left} free question${left===1?"":"s"} left today.`;
}

function showUpgrade() {
  const m = document.getElementById("cgptModal");
  if (!m) return; m.hidden = false;
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.dataset.close !== undefined) m.hidden = true;
  }, { once: true });
}

async function sendComplianceQuestion(msg) {
  // Backend should enforce real limits; this front-end is just UX.
  const quota = getQuota();
  if ((quota.used || 0) >= CGPT.FREE_LIMIT) {
    showUpgrade();
    throw new Error("Free limit reached");
  }
  const threadId = getThread();

  const res = await api("/chat/compliance", {
    method: "POST",
    body: JSON.stringify({ message: msg, thread_id: threadId || undefined })
  });
  if (res.thread_id) setThread(res.thread_id);
  useQuota();
  return res; // { reply, thread_id, usage?: { free_remaining, tier } }
}

function wireComplianceGPT() {
  const form = document.getElementById("cgptForm");
  const input = document.getElementById("cgptInput");
  const win = document.getElementById("cgptWindow");
  const counter = document.getElementById("cgptCounter");
  const clearBtn = document.getElementById("cgptClear");
  if (!form || !input || !win || !counter) return;

  // initial
  win.innerHTML = "";
  renderMsg(win, "assistant", "Hi! I’m your GIS Compliance Assistant. Ask me about SOC 2, ISO 27001, HIPAA, GDPR, or policy specifics.");
  setCounter(counter);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    renderMsg(win, "user", q);
    input.value = "";
    renderMsg(win, "assistant", "Thinking…");

    try {
      const out = await sendComplianceQuestion(q);
      // replace last assistant bubble content
      const last = win.querySelector(".msg.assistant:last-child .bubble");
      last.textContent = out.reply || "(No reply)";
    } catch (err) {
      const last = win.querySelector(".msg.assistant:last-child .bubble");
      last.textContent = err.message || "Something went wrong.";
    } finally {
      setCounter(counter);
    }
  });

  clearBtn?.addEventListener("click", () => {
    localStorage.removeItem(CGPT.THREAD_KEY);
    win.innerHTML = "";
    renderMsg(win, "assistant", "Chat cleared. Ask another compliance question.");
  });
}

document.addEventListener("DOMContentLoaded", wireComplianceGPT);