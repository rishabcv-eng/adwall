const $ = (id) => document.getElementById(id);
const FEATURES = ["annoyances", "collapse", "youtubeAds", "sponsorSkip", "autoUpdate"];
const DEFAULT_FEATURES = { annoyances: false, collapse: true, youtubeAds: true, sponsorSkip: false, autoUpdate: true };
// Rough average weight of a blocked ad/tracker request, for the "not downloaded" estimate.
const AVG_REQUEST_KB = 55;

const fmt = (n) => n.toLocaleString();

async function state() {
  const s = await chrome.storage.local.get({
    enabled: true, allowlist: [], customFilters: {}, features: {},
    stats: { total: 0, days: {}, domains: {} }, update: null,
  });
  s.features = { ...DEFAULT_FEATURES, ...s.features };
  return s;
}

function renderStats({ stats }) {
  const today = new Date().toISOString().slice(0, 10);
  $("statTotal").textContent = fmt(stats.total);
  $("statToday").textContent = fmt(stats.days[today] || 0);
  $("statSites").textContent = fmt(Object.keys(stats.domains).length);
  $("statSaved").textContent = fmt(Math.round((stats.total * AVG_REQUEST_KB) / 1024));

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push([key, stats.days[key] || 0]);
  }
  const max = Math.max(1, ...days.map(([, n]) => n));
  $("chart").innerHTML = days.map(([key, n]) =>
    `<div class="bar" style="height:${Math.max(2, (n / max) * 100)}%" title="${key}: ${fmt(n)} blocked"><span>${key.slice(8)}</span></div>`
  ).join("");

  const top = Object.entries(stats.domains).sort((a, b) => b[1] - a[1]).slice(0, 15);
  $("topDomains").innerHTML = top.length
    ? top.map(([host, n]) => `<li><span class="host">${host}</span><span class="count">${fmt(n)}</span></li>`).join("")
    : '<li class="empty">Nothing blocked yet.</li>';
}

function renderFeatures({ features }) {
  for (const key of FEATURES) $(`f-${key}`).checked = !!features[key];
}

async function renderFilters({ update }) {
  let info = {};
  try { info = await fetch(chrome.runtime.getURL("rules/build-info.json")).then((r) => r.json()); } catch {}
  const parts = [
    ["Blocking rules", fmt(info.network?.rules || 0)],
    ["Ad/tracker domains", fmt(info.network?.domains || 0)],
    ["Hiding rules", fmt((info.cosmetic?.generic || 0) + (info.cosmetic?.sites || 0))],
    ["Scriptlet filters", fmt(info.scriptlets?.filters || 0)],
    ["Annoyance rules", fmt((info.annoyanceNetwork?.rules || 0) + (info.annoyanceCosmetic?.generic || 0))],
    ["Compiled", info.built || "unknown"],
    ["Last auto-update", update?.time ? new Date(update.time).toLocaleString() : "never"],
    ["Added since compile", update ? `${fmt(update.counts?.domains || 0)} domains, ${fmt(update.counts?.sites || 0)} sites` : "—"],
  ];
  $("filterInfo").innerHTML = parts.map(([k, v]) => `<div>${k}: <b>${v}</b></div>`).join("");
  $("annoyanceCount").textContent = info.annoyanceNetwork
    ? `${fmt(info.annoyanceNetwork.rules)} blocking rules + ${fmt(info.annoyanceCosmetic.generic)} hiding rules`
    : "Cookie notices, newsletter popups, chat widgets";
}

function renderSites({ allowlist, customFilters }) {
  $("allowlist").innerHTML = allowlist.length
    ? allowlist.map((host) => `<li><span class="host">${host}</span><button class="remove" data-allow="${host}" title="Resume blocking">×</button></li>`).join("")
    : '<li class="empty">None. Pause a site from the toolbar popup.</li>';

  const entries = Object.entries(customFilters).filter(([, sels]) => sels.length);
  $("custom").innerHTML = entries.length
    ? entries.map(([host, sels]) => `<li><span class="host">${host}</span><span class="count">${sels.length}</span><button class="remove" data-custom="${host}" title="Clear">×</button></li>`).join("")
    : '<li class="empty">None. Use the popup to block an element.</li>';
}

async function render() {
  const s = await state();
  renderStats(s);
  renderFeatures(s);
  renderSites(s);
  await renderFilters(s);
}

$("version").textContent = `v${chrome.runtime.getManifest().version}`;

for (const key of FEATURES) {
  $(`f-${key}`).addEventListener("change", async (e) => {
    const { features } = await state();
    await chrome.storage.local.set({ features: { ...features, [key]: e.target.checked } });
    await chrome.runtime.sendMessage({ type: "sync" });
    await render();
  });
}

$("updateNow").addEventListener("click", async () => {
  $("updateNow").disabled = true;
  $("updateNote").textContent = "Downloading filter lists…";
  const res = await chrome.runtime.sendMessage({ type: "update" });
  $("updateNow").disabled = false;
  if (res?.error) {
    $("updateNote").textContent = `Update failed: ${res.error}`;
  } else {
    const { domains, sites, generic } = res.counts;
    $("updateNote").textContent = `Updated: ${fmt(domains)} domains, ${fmt(sites)} sites, ${fmt(generic)} new hiding rules.`;
  }
  await render();
});

document.addEventListener("click", async (e) => {
  const allow = e.target.dataset?.allow;
  const custom = e.target.dataset?.custom;
  if (allow) {
    const { allowlist } = await state();
    await chrome.storage.local.set({ allowlist: allowlist.filter((d) => d !== allow) });
    await chrome.runtime.sendMessage({ type: "sync" });
    await render();
  } else if (custom) {
    const { customFilters } = await state();
    delete customFilters[custom];
    await chrome.storage.local.set({ customFilters });
    await render();
  }
});

$("resetStats").addEventListener("click", async () => {
  await chrome.storage.local.set({ stats: { total: 0, days: {}, domains: {} } });
  await render();
});

$("resetAll").addEventListener("click", async () => {
  await chrome.storage.local.set({
    enabled: true, allowlist: [], customFilters: {}, features: DEFAULT_FEATURES,
    stats: { total: 0, days: {}, domains: {} },
  });
  await chrome.runtime.sendMessage({ type: "sync" });
  await render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) render();
});

await render();
