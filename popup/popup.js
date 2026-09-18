const $ = (id) => document.getElementById(id);
const DEFAULT_FEATURES = { annoyances: false, collapse: true, youtubeAds: true, sponsorSkip: false, autoUpdate: true };

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

let host = "";
try {
  const url = new URL(tab.url);
  if (url.protocol === "http:" || url.protocol === "https:") host = url.hostname;
} catch {}
const siteKey = host.replace(/^www\./, "");

async function load() {
  const s = await chrome.storage.local.get({ enabled: true, allowlist: [], customFilters: {}, features: {} });
  return { ...s, features: { ...DEFAULT_FEATURES, ...s.features } };
}

const coversHost = (domain) => host === domain || host.endsWith(`.${domain}`);

// The background page counts blocked requests per tab; fall back to the badge.
async function blockedCount() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "pageCount", tabId: tab.id });
    if (typeof res?.count === "number") return String(res.count);
  } catch {}
  const badge = await chrome.action.getBadgeText({ tabId: tab.id });
  return /^\d+$/.test(badge) ? badge : "0";
}

async function render() {
  const { enabled, allowlist, customFilters, features } = await load();
  const allowed = allowlist.some(coversHost);
  const active = enabled && host && !allowed;

  document.body.classList.toggle("off", !active);
  $("global").checked = enabled;
  $("count").textContent = await blockedCount();

  $("host").textContent = host || "This page can't be filtered";
  $("siteToggle").checked = !!host && !allowed;
  $("siteToggle").disabled = !host || !enabled;
  $("siteState").textContent = !enabled ? "AdWall is off" : allowed ? "Paused on this site" : "Blocking on this site";

  $("annoyances").checked = features.annoyances;
  $("annoyances").disabled = !enabled;

  $("zap").disabled = !active;
  const zapped = (customFilters[host] || []).length;
  $("zapCount").textContent = zapped;
  $("reset").hidden = zapped === 0;
}

async function applyAndReload(message) {
  const res = await chrome.runtime.sendMessage({ type: "sync" });
  if (res?.error) {
    $("note").textContent = `Couldn't apply: ${res.error}`;
    return;
  }
  $("note").textContent = message;
  if (host) chrome.tabs.reload(tab.id);
  await render();
}

$("global").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  await applyAndReload(e.target.checked ? "AdWall on — reloading page" : "AdWall off — reloading page");
});

$("siteToggle").addEventListener("change", async (e) => {
  const { allowlist } = await load();
  const next = e.target.checked
    ? allowlist.filter((d) => !coversHost(d))
    : [...new Set([...allowlist, siteKey])];
  await chrome.storage.local.set({ allowlist: next });
  await applyAndReload(e.target.checked ? "Blocking resumed — reloading" : "Paused on this site — reloading");
});

$("annoyances").addEventListener("change", async (e) => {
  const { features } = await load();
  await chrome.storage.local.set({ features: { ...features, annoyances: e.target.checked } });
  await applyAndReload(e.target.checked ? "Cookie banners blocked — reloading" : "Cookie banner blocking off — reloading");
});

$("zap").addEventListener("click", async () => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/picker.js"] });
    window.close();
  } catch {
    $("note").textContent = "This page doesn't allow extensions to run.";
  }
});

$("reset").addEventListener("click", async () => {
  const { customFilters } = await load();
  delete customFilters[host];
  await chrome.storage.local.set({ customFilters });
  $("note").textContent = "Custom blocks cleared — reloading";
  chrome.tabs.reload(tab.id);
  await render();
});

$("dashboard").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

await render();
