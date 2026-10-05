"use strict";

const $ = (id) => document.getElementById(id);
const state = { hikes: [], post: null, detail: null, item: null, assets: [], immichUrl: "",
                placeEdit: null };

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

// Inputs that edit the selected item's report entry: only usable once it has one.
const ENTRY_INPUTS = ["local-path", "local-apply", "remote-path", "remote-apply", "pick-btn"];

function msg(text, isError) {
  const el = $("msg");
  el.textContent = text || "";
  el.style.color = isError ? "#cf222e" : "";
}

// A list row: a name on the left, a grayed detail on the right.
function listItem(name, sub, onClick) {
  const li = document.createElement("li");
  for (const [className, text] of [["name", name], ["sub", sub]]) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    li.appendChild(span);
  }
  li.onclick = onClick;
  return li;
}

// --- hikes -------------------------------------------------------------------

function renderHikes() {
  const needle = $("hike-filter").value.trim().toLowerCase();
  const ul = $("hikes");
  ul.innerHTML = "";
  let placesHeader = false;
  for (const h of state.hikes) {
    if (needle && !h.name.toLowerCase().includes(needle)) continue;
    // Place docs come after the posts (the server lists them that way), under their own heading.
    if (h.kind === "place" && !placesHeader) {
      placesHeader = true;
      const group = document.createElement("li");
      group.className = "group";
      group.textContent = "Places";
      ul.appendChild(group);
    }
    // matched / photos / all media — videos and YouTube can never be matched,
    // so the middle number is the one worth judging progress against.
    const c = h.counts || {};
    const label = c.media ? `${c.matched}/${c.photos}/${c.media}` : "—";
    const li = listItem(h.name.replace(/\.md$/, ""), label, () => selectHike(h.name));
    li.className = h.name === state.post ? "sel" : "";
    li.title = c.media
      ? `${c.matched} matched of ${c.photos} photos (${c.media} media items)` : h.name;
    ul.appendChild(li);
  }
}

async function loadHikes() {
  state.hikes = (await api("/api/hikes")).hikes;
  renderHikes();
}

function hikesMessage() {
  const places = state.hikes.filter((h) => h.kind === "place").length;
  return `${state.hikes.length - places} hikes, ${places} places`;
}

async function selectHike(name) {
  if (name !== state.post) clearItem();
  state.post = name;
  renderHikes();
  msg("Loading…");
  state.detail = await api(`/api/hikes/${encodeURIComponent(name)}`);
  renderDetail();
  msg("");
}

// The open hike re-read from the server, and the list's counts with it.
async function reloadPost() {
  await selectHike(state.post);
  await loadHikes();
}

// A write's returned detail shown, and the list's counts updated to match.
async function applyDetail(detail) {
  state.detail = detail;
  renderDetail();
  await loadHikes();
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
  // A place doc has no page of its own, so nothing to open; it gets a text editor instead.
  const isPlace = d.kind === "place";
  $("rerun-btn").textContent = isPlace ? "Re-run match for this place" : "Re-run match for this hike";
  $("edit-place-btn").hidden = !isPlace;
  const site = $("open-site");
  site.href = d.site_url || "#";
  site.setAttribute("aria-disabled", d.site_url ? "false" : "true");
  site.title = d.site_url || "";

  const ul = $("media");
  ul.innerHTML = "";
  for (const m of d.media) {
    const li = listItem(m.label, m.matched_name || "", () => selectItem(m));
    li.style.color = m.color;
    if (state.item && state.item.web_path === m.web_path) li.className = "sel";
    li.title = `${m.status}${m.in_report ? "" : " (not in JSON)"}`;
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

  for (const id of ENTRY_INPUTS) $(id).disabled = !m.in_report;
  $("local-path").value = m.web_path;
  $("remote-path").value = m.matched_name || "";
  $("remove-btn").disabled = false;

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

  $("remote-open").disabled = !m.match;
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

function clearItem() {
  state.item = null;
  $("remove-btn").disabled = true;
  for (const id of [...ENTRY_INPUTS, "remote-open"]) $(id).disabled = true;
  $("local-path").value = "";
  $("remote-path").value = "";
  const badge = $("entry-status");
  badge.textContent = "";
  badge.style.color = badge.style.borderColor = "";
  showFrame("local", null, "Select a media item");
  showFrame("remote", null, "");
  $("local-caption").textContent = $("remote-caption").textContent = "";
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
    await applyDetail(r.detail);
    msg("Local path saved");
  } catch (e) { msg(e.message, true); }
}

async function applyRemote() {
  try {
    const r = await post("/api/entry/remote", {
      post: state.post, web_path: state.item.web_path, value: $("remote-path").value,
    });
    await applyDetail(r.detail);
    msg($("remote-path").value ? "Match saved" : "Match cleared");
  } catch (e) { msg(e.message, true); }
}

async function removeItem() {
  const m = state.item;
  if (!m) return;
  const what = [
    m.in_report && "its entry in the JSON",
    "its reference and front matter in the post",
    m.kind !== "youtube" && m.has_local && "its local files",
  ].filter(Boolean).join(", ");
  if (!confirm(`Remove ${m.label}?\n\nThis deletes ${what}.`)) return;
  try {
    const r = await post("/api/entry/remove", { post: state.post, web_path: m.web_path });
    clearItem();
    await applyDetail(r.detail);
    const x = r.removed;
    msg(`Removed ${m.label}: ` + [
      x.in_report && "JSON entry",
      x.md_lines && `${x.md_lines} line(s) in the post`,
      x.files.length && `${x.files.length} file(s)`,
    ].filter(Boolean).join(", "));
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
  state.immichUrl = s.immich_url || "";
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

// Tests the saved settings and shows the outcome in the header pill. Returns
// the test's result, or `{ error }` when it failed.
async function checkConnection() {
  const pill = $("conn");
  try {
    const r = await post("/api/settings/test", {});
    pill.textContent = `Immich: ${r.albums} albums`;
    pill.className = "pill ok";
    return r;
  } catch (e) {
    pill.textContent = `Immich: ${e.message}`;
    pill.className = "pill bad";
    return { error: e.message };
  }
}

// The settings dialog's fields sent to the server. An empty key box keeps the current key.
function saveSettings() {
  const key = $("set-key").value.trim();
  return post("/api/settings", {
    api_key: key,
    immich_url: $("set-url").value.trim(),
    remember: $("set-remember").checked,
    keep: !key,
  });
}

async function openPicker(targetInput, onPick) {
  const dlg = $("pick-dlg");
  const list = $("pick-list");
  // A place doc has no date to search around: search Immich by text and/or dates instead.
  // The last search stays the place's candidates on the server, for matching and Apply.
  const isPlace = state.detail?.kind === "place";
  $("pick-search").hidden = !isPlace;
  const fail = (message) => {
    list.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = message;
    list.appendChild(li);
  };
  const load = async (params) => {
    list.innerHTML = "<li>Loading…</li>";
    const query = params ? `?${new URLSearchParams(params)}` : "";
    try {
      state.assets = (await api(`/api/assets/${encodeURIComponent(state.post)}${query}`)).assets;
    } catch (e) {
      fail(e.message);
      return false;
    }
    return true;
  };
  $("pick-go").onclick = async () => {
    if (await load({ q: $("pick-query").value.trim(), from: $("pick-from").value, to: $("pick-to").value })) draw();
  };
  $("pick-query").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("pick-go").click(); } };
  dlg.showModal();
  if (!(await load())) return;
  const draw = () => {
    const needle = $("pick-filter").value.trim().toLowerCase();
    list.innerHTML = "";
    if (isPlace && !state.assets.length) {
      fail("Search Immich above: a text like the place's name, and/or dates.");
      return;
    }
    for (const a of state.assets) {
      if (needle && !a.name.toLowerCase().includes(needle)) continue;
      list.appendChild(listItem(a.name, `${a.taken} · ${a.size}`,
                                () => { targetInput.value = a.name; dlg.close(); onPick?.(); }));
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
    await reloadPost();
    msg(`Added ${result.web_path.split("/").pop()} (${result.status})`);
  } catch (e) { msg(e.message, true); }
}

async function rerun() {
  try {
    $("rerun-btn").disabled = true;
    const { job } = await post("/api/rerun", { post: state.post });
    const result = await waitForJob(job, `Matching ${state.post}`);
    await reloadPost();
    msg((result.output || "done").split("\n")[0]);
  } catch (e) { msg(e.message, true); }
  finally { $("rerun-btn").disabled = false; }
}

// --- place docs ----------------------------------------------------------------

async function openPlaceEditor(create) {
  const fields = ["title", "description", "tags", "aliases", "body"];
  state.placeEdit = { create };
  $("place-slug-row").hidden = !create;
  $("place-dlg-title").textContent = create ? "New place" : `Edit ${state.post}`;
  $("place-insert").disabled = create || !state.item || state.item.kind === "youtube";
  $("place-hint").textContent = create
    ? "Creates <slug>.md next to the posts. Add images afterwards with Add media…, then insert them into the text."
    : "Images: add them with Add media…, select one in the list, then Insert selected image.";
  if (create) {
    $("place-slug").value = "";
    for (const f of fields) $(`place-${f}`).value = "";
  } else {
    try {
      const p = await api(`/api/places/${encodeURIComponent(state.post)}`);
      $("place-title").value = p.title;
      $("place-description").value = p.description;
      $("place-tags").value = p.tags.join(", ");
      $("place-aliases").value = p.aliases.join(", ");
      $("place-body").value = p.body;
    } catch (e) { msg(e.message, true); return; }
  }
  $("place-dlg").showModal();
}

function insertSelectedImage() {
  const m = state.item;
  if (!m) return;
  const body = $("place-body");
  const caption = m.label.replace(/\.[^.]+$/, "");
  const sep = body.value.endsWith("\n\n") || !body.value ? "" : body.value.endsWith("\n") ? "\n" : "\n\n";
  body.value += `${sep}![${caption}](${m.web_path})\n`;
  body.focus();
}

async function savePlace() {
  const create = state.placeEdit?.create;
  const split = (id) => $(id).value.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const r = await post("/api/places/save", {
      create,
      slug: $("place-slug").value.trim(),
      name: create ? undefined : state.post,
      title: $("place-title").value.trim(),
      description: $("place-description").value.trim(),
      tags: split("place-tags"),
      aliases: split("place-aliases"),
      body: $("place-body").value,
    });
    state.hikes = r.hikes;
    state.post = r.detail.name;
    state.detail = r.detail;
    renderHikes();
    renderDetail();
    msg(create ? `Created ${r.detail.name}` : `Saved ${r.detail.name}`);
  } catch (e) {
    msg(e.message, true);
    // Keep what was typed: reopen the editor on a failed save.
    $("place-dlg").showModal();
  }
}

// --- wiring ------------------------------------------------------------------

$("refresh-btn").onclick = async () => {
  state.hikes = (await post("/api/refresh", {})).hikes;
  renderHikes();
  msg(hikesMessage());
};
$("hike-filter").oninput = renderHikes;
$("local-apply").onclick = applyLocal;
$("remote-apply").onclick = applyRemote;
$("local-path").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applyLocal(); } };
$("remote-path").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); applyRemote(); } };
$("pick-btn").onclick = () => openPicker($("remote-path"));
$("remote-open").onclick = () => {
  if (!state.item?.match || !state.immichUrl) return;
  window.open(`${state.immichUrl}/photos/${state.item.match.asset_id}`, "_blank", "noopener");
};
$("add-pick").onclick = () => openPicker($("add-asset"), suggestOutName);
$("add-asset").onchange = suggestOutName;
$("settings-btn").onclick = openSettings;
$("add-btn").onclick = () => { syncAddDialog(); $("add-dlg").showModal(); };
$("rerun-btn").onclick = rerun;
$("new-place-btn").onclick = () => openPlaceEditor(true);
$("edit-place-btn").onclick = () => openPlaceEditor(false);
$("place-insert").onclick = insertSelectedImage;
$("place-dlg").addEventListener("close", () => {
  if ($("place-dlg").returnValue === "save") savePlace();
});
$("remove-btn").onclick = removeItem;
for (const r of document.querySelectorAll('input[name="mode"]')) r.onchange = syncAddDialog;

$("settings-dlg").addEventListener("close", async () => {
  if ($("settings-dlg").returnValue !== "save") return;
  try {
    await saveSettings();
    state.immichUrl = $("set-url").value.trim();
    await checkConnection();
    msg("Settings saved");
  } catch (e) { msg(e.message, true); }
});
$("set-test").onclick = async () => {
  if ($("set-key").value.trim() || $("set-url").value.trim()) await saveSettings();
  const r = await checkConnection();
  $("set-hint").textContent = r.error || `OK — ${r.albums} albums`;
};
$("add-dlg").addEventListener("close", () => {
  if ($("add-dlg").returnValue === "add") submitAdd();
});

$("open-site").setAttribute("aria-disabled", "true");

(async function boot() {
  await loadHikes();
  state.immichUrl = (await api("/api/settings")).immich_url || "";
  await checkConnection();
  msg(hikesMessage());
})();
