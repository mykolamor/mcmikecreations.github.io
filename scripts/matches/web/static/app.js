"use strict";

const $ = (id) => document.getElementById(id);
const state = { hikes: [], post: null, detail: null, item: null, assets: [] };

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const post = (path, body) =>
  api(path, { method: "POST", body: JSON.stringify(body || {}) });

function msg(text, isError) {
  const el = $("msg");
  el.textContent = text || "";
  el.style.color = isError ? "#cf222e" : "";
}

// --- hikes -------------------------------------------------------------------

function renderHikes() {
  const needle = $("hike-filter").value.trim().toLowerCase();
  const ul = $("hikes");
  ul.innerHTML = "";
  for (const h of state.hikes) {
    if (needle && !h.name.toLowerCase().includes(needle)) continue;
    const li = document.createElement("li");
    li.className = h.name === state.post ? "sel" : "";
    // matched / photos / all media — videos and YouTube can never be matched,
    // so the middle number is the one worth judging progress against.
    const c = h.counts || {};
    const label = c.media ? `${c.matched}/${c.photos}/${c.media}` : "—";
    li.innerHTML = `<span class="name"></span><span class="sub"></span>`;
    li.querySelector(".sub").textContent = label;
    li.querySelector(".name").textContent = h.name.replace(/\.md$/, "");
    li.title = c.media
      ? `${c.matched} matched of ${c.photos} photos (${c.media} media items)` : h.name;
    li.onclick = () => selectHike(h.name);
    ul.appendChild(li);
  }
}

async function loadHikes() {
  state.hikes = (await api("/api/hikes")).hikes;
  renderHikes();
}

async function selectHike(name) {
  state.post = name;
  renderHikes();
  msg("Loading…");
  state.detail = await api(`/api/hikes/${encodeURIComponent(name)}`);
  renderDetail();
  msg("");
}

// --- media -------------------------------------------------------------------

function renderDetail() {
  const d = state.detail;
  $("post-name").textContent = d.name;
  const album = (d.album && d.album.name) || "(date window only)";
  const win = d.date_window || {};
  $("post-meta").textContent =
    `${album} · ${d.candidate_count} candidates` +
    (win.from ? ` · ${win.from} → ${win.to}` : "");
  $("add-btn").disabled = false;
  $("rerun-btn").disabled = false;
  const site = $("open-site");
  site.href = d.site_url || "#";
  site.setAttribute("aria-disabled", d.site_url ? "false" : "true");
  site.title = d.site_url || "";

  const ul = $("media");
  ul.innerHTML = "";
  for (const m of d.media) {
    const li = document.createElement("li");
    li.style.color = m.color;
    if (state.item && state.item.web_path === m.web_path) li.className = "sel";
    li.innerHTML = `<span class="name"></span><span class="sub"></span>`;
    li.querySelector(".name").textContent = m.label;
    li.querySelector(".sub").textContent = m.matched_name || "";
    li.title = `${m.status}${m.in_report ? "" : " (not in JSON)"}`;
    li.onclick = () => selectItem(m);
    ul.appendChild(li);
  }
  // Keep the open item in sync after a save.
  if (state.item) {
    const again = d.media.find((m) => m.web_path === state.item.web_path);
    if (again) selectItem(again, true);
  }
}

function selectItem(m, keepMessage) {
  state.item = m;
  renderSelection();
  const badge = $("entry-status");
  badge.textContent = m.status;
  badge.style.color = m.color;
  badge.style.borderColor = m.color;

  for (const id of ["local-path", "local-apply", "remote-path", "remote-apply", "pick-btn"]) {
    $(id).disabled = !m.in_report;
  }
  $("local-path").value = m.web_path;
  $("remote-path").value = m.matched_name || "";

  if (m.kind === "youtube") {
    showFrame("local", null, "YouTube embed — nothing stored locally");
  } else if (!m.has_local) {
    showFrame("local", null, `missing on disk:\n${m.web_path}`);
  } else {
    showFrame("local", `/api/media?path=${encodeURIComponent(m.web_path)}`, "");
  }
  $("local-caption").textContent =
    [m.web_path, m.local_size != null && humanSize(m.local_size)]
      .filter(Boolean).join(" · ");

  if (!m.match) {
    showFrame("remote", null, m.in_report ? "no Immich match recorded"
                                          : "not in the JSON yet — use Add media");
    $("remote-caption").textContent = "";
  } else {
    showFrame("remote", `/api/preview/${m.match.asset_id}`, "");
    const s = m.match.scores || {};
    const parts = Object.entries(s)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${v}`);
    $("remote-caption").textContent =
      [m.match.original_path, m.match.file_size && humanSize(m.match.file_size),
       m.confidence && `confidence=${m.confidence}`,
       m.resolved_by && `via ${m.resolved_by}`, parts.join(" ")]
        .filter(Boolean).join(" · ");
  }
  if (!keepMessage) msg("");
}

function humanSize(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderSelection() {
  for (const li of $("media").children) li.className = "";
  const d = state.detail;
  if (!d || !state.item) return;
  const i = d.media.findIndex((m) => m.web_path === state.item.web_path);
  if (i >= 0 && $("media").children[i]) $("media").children[i].className = "sel";
}

function showFrame(which, src, hint) {
  const frame = $(`${which}-frame`);
  frame.classList.remove("scroll");
  frame.innerHTML = "";
  if (!src) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = hint;
    frame.appendChild(span);
    return;
  }
  const img = document.createElement("img");
  img.src = src;
  img.onerror = () => showFrame(which, null, "could not load image");
  // Click to view at native resolution, click again to fit.
  img.onclick = () => {
    img.classList.toggle("zoom");
    frame.classList.toggle("scroll", img.classList.contains("zoom"));
  };
  frame.appendChild(img);
}

// --- edits -------------------------------------------------------------------

async function applyLocal() {
  try {
    const r = await post("/api/entry/local", {
      post: state.post, web_path: state.item.web_path, value: $("local-path").value,
    });
    state.item = { ...state.item, web_path: r.web_path };
    state.detail = r.detail;
    renderDetail();
    await loadHikes();
    msg("Local path saved");
  } catch (e) { msg(e.message, true); }
}

async function applyRemote() {
  try {
    const r = await post("/api/entry/remote", {
      post: state.post, web_path: state.item.web_path, value: $("remote-path").value,
    });
    state.detail = r.detail;
    renderDetail();
    await loadHikes();
    msg($("remote-path").value ? "Match saved" : "Match cleared");
  } catch (e) { msg(e.message, true); }
}

// --- jobs --------------------------------------------------------------------

async function waitForJob(job, label) {
  msg(`${label}…`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    const j = await api(`/api/jobs/${job.id}`);
    if (j.state === "running") continue;
    if (j.state === "error") throw new Error(j.error);
    return j.result;
  }
}

// --- dialogs -----------------------------------------------------------------

async function openSettings() {
  const s = await api("/api/settings");
  $("set-url").value = s.immich_url || "";
  $("set-key").value = "";
  $("set-key").placeholder = s.has_key
    ? `key set (${s.key_hint}) — type to replace` : "paste your Immich API key";
  $("set-remember").checked = s.key_remembered;
  $("set-hint").textContent = "";
  $("set-paths").innerHTML =
    `posts: ${s.posts_dir}<br>static: ${s.static_root}<br>` +
    `reports: ${s.out_dir}<br>remembered key: ${s.config_path}`;
  $("settings-dlg").showModal();
}

async function checkConnection() {
  const pill = $("conn");
  try {
    const r = await post("/api/settings/test", {});
    pill.textContent = `Immich: ${r.albums} albums`;
    pill.className = "pill ok";
  } catch (e) {
    pill.textContent = `Immich: ${e.message}`;
    pill.className = "pill bad";
  }
}

async function openPicker(targetInput, onPick) {
  const dlg = $("pick-dlg");
  const list = $("pick-list");
  list.innerHTML = "<li>Loading…</li>";
  dlg.showModal();
  try {
    state.assets = (await api(`/api/assets/${encodeURIComponent(state.post)}`)).assets;
  } catch (e) {
    list.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = e.message;
    list.appendChild(li);
    return;
  }
  const draw = () => {
    const needle = $("pick-filter").value.trim().toLowerCase();
    list.innerHTML = "";
    for (const a of state.assets) {
      if (needle && !a.name.toLowerCase().includes(needle)) continue;
      const li = document.createElement("li");
      li.innerHTML = `<span class="name"></span><span class="sub">${a.taken} · ${a.size}</span>`;
      li.querySelector(".name").textContent = a.name;
      li.onclick = () => { targetInput.value = a.name; dlg.close(); onPick?.(); };
      list.appendChild(li);
    }
  };
  $("pick-filter").oninput = draw;
  draw();
}

function addMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function syncAddDialog() {
  const mode = addMode();
  $("add-local").disabled = mode === "remote";
  $("add-asset").disabled = mode === "local";
  $("add-pick").disabled = mode === "local";
  $("add-out").disabled = mode !== "remote";
  $("add-hint").textContent = {
    local: "The image is already on disk; the matcher searches Immich for its original.",
    remote: "The original is downloaded and converted to AVIF tiers + a blur placeholder into the hike's folder.",
    both: "Nothing is downloaded or matched — the mapping is written straight into the JSON.",
  }[mode];
  suggestOutName();
}

async function suggestOutName() {
  if (addMode() !== "remote") return;
  const asset = $("add-asset").value.trim();
  if (!asset) return;
  try {
    const { name } = await post("/api/entry/suggest_name", { post: state.post, asset });
    $("add-out").value = name;
  } catch (e) { /* best-effort prefill; leave whatever is there */ }
}

async function submitAdd() {
  try {
    const { job } = await post("/api/add", {
      post: state.post,
      mode: addMode(),
      local_path: $("add-local").value.trim(),
      asset_name: $("add-asset").value.trim(),
      out_name: $("add-out").value.trim(),
    });
    const result = await waitForJob(job, "Adding media");
    await selectHike(state.post);
    await loadHikes();
    msg(`Added ${result.web_path.split("/").pop()} (${result.status})`);
  } catch (e) { msg(e.message, true); }
}

async function rerun() {
  try {
    $("rerun-btn").disabled = true;
    const { job } = await post("/api/rerun", { post: state.post });
    const result = await waitForJob(job, `Matching ${state.post}`);
    await selectHike(state.post);
    await loadHikes();
    msg((result.output || "done").split("\n")[0]);
  } catch (e) { msg(e.message, true); }
  finally { $("rerun-btn").disabled = false; }
}

// --- wiring ------------------------------------------------------------------

$("refresh-btn").onclick = async () => {
  state.hikes = (await post("/api/refresh", {})).hikes;
  renderHikes();
  msg(`${state.hikes.length} hikes`);
};
$("hike-filter").oninput = renderHikes;
$("local-apply").onclick = applyLocal;
$("remote-apply").onclick = applyRemote;
$("local-path").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applyLocal(); } };
$("remote-path").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applyRemote(); } };
$("pick-btn").onclick = () => openPicker($("remote-path"));
$("add-pick").onclick = () => openPicker($("add-asset"), suggestOutName);
$("add-asset").onchange = suggestOutName;
$("settings-btn").onclick = openSettings;
$("add-btn").onclick = () => { syncAddDialog(); $("add-dlg").showModal(); };
$("rerun-btn").onclick = rerun;
for (const r of document.querySelectorAll('input[name="mode"]')) r.onchange = syncAddDialog;

$("settings-dlg").addEventListener("close", async () => {
  if ($("settings-dlg").returnValue !== "save") return;
  try {
    await post("/api/settings", {
      api_key: $("set-key").value.trim(),
      immich_url: $("set-url").value.trim(),
      remember: $("set-remember").checked,
      keep: !$("set-key").value.trim(),
    });
    await checkConnection();
    msg("Settings saved");
  } catch (e) { msg(e.message, true); }
});
$("set-test").onclick = async () => {
  const key = $("set-key").value.trim();
  const url = $("set-url").value.trim();
  if (key || url) {
    await post("/api/settings", {
      api_key: key, immich_url: url, keep: !key,
      remember: $("set-remember").checked,
    });
  }
  try {
    const r = await post("/api/settings/test", {});
    $("set-hint").textContent = `OK — ${r.albums} albums`;
  } catch (e) { $("set-hint").textContent = e.message; }
  await checkConnection();
};
$("add-dlg").addEventListener("close", () => {
  if ($("add-dlg").returnValue === "add") submitAdd();
});

$("open-site").setAttribute("aria-disabled", "true");

(async function boot() {
  await loadHikes();
  await checkConnection();
  msg(`${state.hikes.length} hikes`);
})();
