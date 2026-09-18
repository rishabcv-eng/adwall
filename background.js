// AdWall service worker: network rules, content scripts, scriptlets, per-site CSS,
// live statistics and daily filter updates.
// Settings live in chrome.storage.local: enabled, allowlist, features, stats, update.

const AD_RULESETS = ["core", "lists"];
const ANNOYANCE_RULESET = "annoyances";
const ALLOW_RULE_ID = 1;
const UPDATE_RULE_START = 1000;
const UPDATE_CHUNK = 1000;
const UPDATE_MAX_DOMAINS = 300000;
const UPDATE_PERIOD_MINUTES = 720;
const STATS_FLUSH_MS = 10000;
const MAX_TRACKED_DOMAINS = 500;
const MAX_TRACKED_DAYS = 30;

const DEFAULT_FEATURES = { annoyances: false, collapse: true, youtubeAds: true, sponsorSkip: false, autoUpdate: true };

const readJson = (p) => fetch(chrome.runtime.getURL(p)).then((r) => r.json());
const readText = (p) => fetch(chrome.runtime.getURL(p)).then((r) => r.text());

async function getSettings() {
  const s = await chrome.storage.local.get({ enabled: true, allowlist: [], features: {} });
  return { enabled: s.enabled, allowlist: s.allowlist, features: { ...DEFAULT_FEATURES, ...s.features } };
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };
const ancestors = (host) => { const l = host.split("."); return l.map((_, i) => l.slice(i).join(".")); };
const isAllowlisted = (host, allowlist) => allowlist.some((d) => host === d || host.endsWith(`.${d}`));
const hostPatterns = (hosts) => [...hosts].flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
const selectorOf = (cssLine) => cssLine.slice(0, cssLine.lastIndexOf("{"));

// --- Compiled filter data (built by tools/build.py) ---------------------------
let dataPromise = null;
function loadData() {
  dataPromise ??= (async () => {
    const empty = { specific: {}, genericExceptions: {}, generichide: [], procedural: {} };
    const [cosmetic, scriptlets, genericCss, allowIds, annoy] = await Promise.all([
      readJson("rules/cosmetic.json"),
      readJson("scriptlets/index.json"),
      readText("rules/generic.css"),
      readJson("rules/allow-ids.json").catch(() => ({})),
      readJson("rules/annoyances-cosmetic.json").catch(() => empty),
    ]);
    return {
      cosmetic, scriptlets, annoy,
      genericLines: genericCss.split("\n").filter(Boolean),
      generichide: new Set(cosmetic.generichide),
      allowIds: new Map(Object.entries(allowIds).map(([k, v]) => [k, new Set(v)])),
    };
  })();
  return dataPromise;
}

let updatePromise = null;
function loadUpdate() {
  updatePromise ??= chrome.storage.local.get({ update: null }).then((s) => s.update);
  return updatePromise;
}

// --- Network rules --------------------------------------------------------------
// Session rules live in memory (dynamic rules fail to persist on some profiles),
// so they are rebuilt from storage every time the service worker starts.
async function applySessionRules(settings) {
  const rules = [];
  if (settings.enabled && settings.allowlist.length) {
    rules.push({
      id: ALLOW_RULE_ID, priority: 100, action: { type: "allowAllRequests" },
      condition: { requestDomains: settings.allowlist, resourceTypes: ["main_frame", "sub_frame"] },
    });
  }
  const update = await loadUpdate();
  if (settings.enabled && update?.domains?.length) {
    const domains = update.domains.slice(0, UPDATE_MAX_DOMAINS);
    for (let i = 0; i < domains.length; i += UPDATE_CHUNK) {
      rules.push({
        id: UPDATE_RULE_START + i / UPDATE_CHUNK, priority: 1, action: { type: "block" },
        condition: { requestDomains: domains.slice(i, i + UPDATE_CHUNK) },
      });
    }
  }
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
}

// --- Content scripts ---------------------------------------------------------------
function script(s, excludes) {
  return excludes.length ? { ...s, excludeMatches: excludes } : s;
}

function contentScripts(settings, data) {
  const userExcludes = hostPatterns(settings.allowlist);
  const genericExcludes = hostPatterns([
    ...settings.allowlist, ...data.generichide, ...Object.keys(data.cosmetic.genericExceptions),
  ]);
  const base = { runAt: "document_start", allFrames: true };
  const list = [
    script({ ...base, id: "cosmetic", matches: ["<all_urls>"], js: ["content/cosmetic.js"], css: ["content/cosmetic.css"] }, userExcludes),
    script({ ...base, id: "generic-css", matches: ["<all_urls>"], css: ["rules/generic.css"] }, genericExcludes),
    script({ ...base, id: "popup-guard", matches: ["<all_urls>"], js: ["content/popup-guard.js"], world: "MAIN" }, userExcludes),
  ];
  if (settings.features.youtubeAds || settings.features.sponsorSkip) {
    list.push(script({ ...base, id: "youtube", matches: ["*://*.youtube.com/*"], js: ["content/youtube.js"], allFrames: false }, userExcludes));
  }
  if (settings.features.annoyances) {
    list.push(script({ ...base, id: "annoyances-css", matches: ["<all_urls>"], css: ["rules/annoyances.css"] }, genericExcludes));
  }
  for (const s of data.scriptlets) {
    list.push(script({ ...base, id: `scriptlet-${s.name}`, matches: s.matches, js: [s.file, "scriptlets/runtime.js"], world: "MAIN" }, userExcludes));
  }
  return list;
}

async function apply() {
  const settings = await getSettings();
  const enableRulesetIds = settings.enabled
    ? [...AD_RULESETS, ...(settings.features.annoyances ? [ANNOYANCE_RULESET] : [])]
    : [];
  const disableRulesetIds = [...AD_RULESETS, ANNOYANCE_RULESET].filter((id) => !enableRulesetIds.includes(id));
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  await applySessionRules(settings);

  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  if (!settings.enabled) return;

  const data = await loadData();
  const wanted = contentScripts(settings, data);
  try {
    await chrome.scripting.registerContentScripts(wanted);
  } catch (err) {
    console.warn("[AdWall] batch registration failed:", err.message);
  }
  // Verify: one rejected pattern must never silently drop the rest.
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  for (const s of wanted) {
    if (have.has(s.id)) continue;
    try {
      await chrome.scripting.registerContentScripts([s]);
    } catch (err) {
      console.warn(`[AdWall] ${s.id} not registered: ${err.message}`);
    }
  }
}

// Serialize applies so overlapping calls never race on script registration.
let queue = Promise.resolve();
function sync() {
  queue = queue.then(apply, apply);
  return queue;
}

// --- Live statistics ---------------------------------------------------------------
const tabState = new Map(); // tabId -> { count, badgeAt }
let pending = { total: 0, domains: Object.create(null) };
let flushTimer = null;

function scheduleFlush() {
  flushTimer ??= setTimeout(flushStats, STATS_FLUSH_MS);
}

async function flushStats() {
  flushTimer = null;
  const batch = pending;
  pending = { total: 0, domains: Object.create(null) };
  if (!batch.total) return;
  const { stats } = await chrome.storage.local.get({ stats: { total: 0, days: {}, domains: {} } });
  stats.total += batch.total;
  const today = new Date().toISOString().slice(0, 10);
  stats.days[today] = (stats.days[today] || 0) + batch.total;
  for (const [domain, n] of Object.entries(batch.domains)) stats.domains[domain] = (stats.domains[domain] || 0) + n;
  const days = Object.keys(stats.days).sort().slice(-MAX_TRACKED_DAYS);
  stats.days = Object.fromEntries(days.map((d) => [d, stats.days[d]]));
  stats.domains = Object.fromEntries(
    Object.entries(stats.domains).sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED_DOMAINS)
  );
  await chrome.storage.local.set({ stats });
}

const setBadge = (tabId, count) =>
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" }).catch(() => {});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async ({ request, rule }) => {
    if (rule.rulesetId === "_session" && rule.ruleId === ALLOW_RULE_ID) return;
    const data = await loadData();
    if (data.allowIds.get(rule.rulesetId)?.has(rule.ruleId)) return; // an exception, not a block
    if (request.tabId >= 0) {
      const state = tabState.get(request.tabId) || { count: 0, badgeAt: 0 };
      state.count++;
      tabState.set(request.tabId, state);
      const now = Date.now();
      if (now - state.badgeAt > 400) {
        state.badgeAt = now;
        setBadge(request.tabId, state.count);
      } else {
        // Always paint the final number once the burst of requests settles.
        clearTimeout(state.badgeTimer);
        state.badgeTimer = setTimeout(() => setBadge(request.tabId, state.count), 500);
      }
    }
    pending.total++;
    const host = hostOf(request.url);
    if (host) pending.domains[host] = (pending.domains[host] || 0) + 1;
    scheduleFlush();
  });
} else {
  // Packed installs cannot use the debug event; fall back to the browser's own counter.
  chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
}

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));

// --- Per-site cosmetic CSS -----------------------------------------------------------
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId === 0) {
    tabState.delete(tabId);
    setBadge(tabId, 0);
  }
  if (!/^https?:/.test(url)) return;
  const settings = await getSettings();
  if (!settings.enabled) return;

  const frameHost = hostOf(url);
  let pageHost = frameHost;
  if (frameId !== 0) {
    try { pageHost = hostOf((await chrome.tabs.get(tabId)).url); } catch {}
  }
  if (isAllowlisted(pageHost, settings.allowlist)) return;

  const [data, update] = await Promise.all([loadData(), loadUpdate()]);
  const hosts = ancestors(frameHost);
  const css = [];
  for (const h of hosts) {
    if (data.cosmetic.specific[h]) css.push(data.cosmetic.specific[h]);
    if (settings.features.annoyances && data.annoy.specific[h]) css.push(data.annoy.specific[h]);
    if (update?.specific?.[h]) css.push(update.specific[h]);
  }

  const hidden = hosts.some((h) => data.generichide.has(h));
  // Sites with generic exceptions are excluded from generic.css; give them a filtered copy.
  const excepted = new Set(hosts.flatMap((h) => data.cosmetic.genericExceptions[h] || []));
  if (excepted.size && !hidden) {
    css.push(data.genericLines.filter((line) => !excepted.has(selectorOf(line))).join("\n"));
  }
  if (update?.generic?.length && !hidden) {
    css.push(update.generic.map((sel) => `${sel}{display:none!important}`).join("\n"));
  }

  if (css.length) {
    chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css: css.join("\n") }).catch(() => {});
  }
});

// --- Filter auto-update -----------------------------------------------------------
const UPDATE_SOURCES = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  "https://ublockorigin.github.io/uAssets/filters/filters.txt",
  "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
  "https://ublockorigin.github.io/uAssets/filters/badware.txt",
  "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
  "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext",
];
const DOMAIN_RULE = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\^$/;
const COSMETIC_RULE = /^([^#@$+]*)##([^+].*)$/;
const BAD_SELECTOR = /[{}]|:(has-text|upward|xpath|matches-|min-text-length|watch-attr|others|style|remove|remove-attr|remove-class|-abp-)\(/;

async function fetchList(url, depth = 0) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const out = [];
  let skipDepth = 0;
  for (const raw of (await res.text()).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("!#if")) { skipDepth++; continue; } // platform-specific block
    if (line.startsWith("!#endif")) { skipDepth = Math.max(0, skipDepth - 1); continue; }
    if (skipDepth) continue;
    if (line.startsWith("!#include ") && depth < 2) {
      try { out.push(...await fetchList(new URL(line.slice(10).trim(), url).href, depth + 1)); } catch {}
      continue;
    }
    if (line && !line.startsWith("!") && !line.startsWith("[")) out.push(line);
  }
  return out;
}

// Applies what can be applied at runtime: whole-domain blocks and element hiding.
// New scriptlets need shipped code, so those still come from tools/build.py.
async function runUpdate() {
  const started = Date.now();
  const domains = new Set();
  const excepted = new Set();
  const specific = Object.create(null);
  const generic = new Set();
  const failed = [];

  for (const url of UPDATE_SOURCES) {
    let lines;
    try {
      lines = await fetchList(url);
    } catch (err) {
      failed.push(err.message);
      continue;
    }
    for (const line of lines) {
      if (line.startsWith("@@")) {
        const m = DOMAIN_RULE.exec(line.slice(2));
        if (m) excepted.add(m[1]);
        continue;
      }
      const domain = DOMAIN_RULE.exec(line);
      if (domain) {
        domains.add(domain[1]);
        continue;
      }
      const cosmetic = COSMETIC_RULE.exec(line);
      if (!cosmetic) continue;
      const sel = cosmetic[2].trim();
      if (!sel || BAD_SELECTOR.test(sel)) continue;
      if (!cosmetic[1]) {
        generic.add(sel);
        continue;
      }
      for (const host of cosmetic[1].split(",")) {
        const h = host.trim().toLowerCase();
        if (!h || h.includes("*") || h.startsWith("~") || !h.includes(".")) continue;
        (specific[h] ||= new Set()).add(sel);
      }
    }
  }

  if (!domains.size) throw new Error(`update failed: ${failed.join("; ") || "no filters parsed"}`);

  const data = await loadData();
  const baseGeneric = new Set(data.genericLines.map(selectorOf));
  const update = {
    time: Date.now(),
    domains: [...domains].filter((d) => !excepted.has(d)).sort(),
    specific: Object.fromEntries(Object.entries(specific).map(
      ([h, sels]) => [h, [...sels].map((s) => `${s}{display:none!important}`).join("\n")])),
    generic: [...generic].filter((s) => !baseGeneric.has(s)).slice(0, 5000),
    failed,
    tookMs: Date.now() - started,
  };
  update.counts = {
    domains: update.domains.length,
    sites: Object.keys(update.specific).length,
    generic: update.generic.length,
  };

  await chrome.storage.local.set({ update });
  updatePromise = Promise.resolve(update);
  await applySessionRules(await getSettings());
  return update;
}

function ensureAlarm() {
  chrome.alarms.get("update").then((alarm) => {
    if (!alarm) chrome.alarms.create("update", { periodInMinutes: UPDATE_PERIOD_MINUTES, delayInMinutes: 5 });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "update") return;
  const { features } = await getSettings();
  if (features.autoUpdate) runUpdate().catch((err) => console.warn("[AdWall]", err.message));
});

// --- SponsorBlock lookup (opt-in) ----------------------------------------------------
// Only the first 4 characters of the video id's SHA-256 hash are sent, so the
// service never learns which video is being watched.
async function sponsorSegments(videoId) {
  if (!/^[\w-]{6,20}$/.test(videoId || "")) return [];
  const { features } = await getSettings();
  if (!features.sponsorSkip) return [];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const categories = encodeURIComponent(JSON.stringify(["sponsor", "selfpromo", "interaction"]));
  try {
    const res = await fetch(`https://sponsor.ajay.app/api/skipSegments/${hex.slice(0, 4)}?categories=${categories}`);
    if (!res.ok) return [];
    const entry = (await res.json()).find((e) => e.videoID === videoId);
    return entry ? entry.segments.map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category })) : [];
  } catch {
    return [];
  }
}

// --- Lifecycle & messages -------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  ensureAlarm();
  sync();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sync();
});

// Session rules are wiped on browser restart and when the extension is re-enabled.
getSettings().then(applySessionRules);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (promise) => {
    promise.then(sendResponse, (err) => sendResponse({ error: String(err.message || err) }));
    return true;
  };
  switch (msg?.type) {
    case "sync":
      return reply(sync().then(() => ({ ok: true })));
    case "procedural":
      return reply((async () => {
        const [{ features }, data] = await Promise.all([getSettings(), loadData()]);
        const hosts = ancestors(hostOf(sender.url || ""));
        const out = hosts.flatMap((h) => data.cosmetic.procedural[h] || []);
        if (features.annoyances) out.push(...hosts.flatMap((h) => data.annoy.procedural[h] || []));
        return out;
      })());
    case "pageCount":
      return reply(Promise.resolve({ count: tabState.get(msg.tabId)?.count || 0 }));
    case "update":
      return reply(runUpdate().then((u) => ({ ok: true, counts: u.counts, failed: u.failed })));
    case "sponsor":
      return reply(sponsorSegments(msg.videoId));
    case "wouldBlock":
      return reply((async () => {
        const data = await loadData();
        const initiator = sender.origin || undefined;
        const tabId = sender.tab?.id ?? -1;
        const out = [];
        for (const { url, kind } of (msg.items || []).slice(0, 40)) {
          try {
            const { matchedRules } = await chrome.declarativeNetRequest.testMatchOutcome({ url, type: kind, initiator, tabId });
            const isAllowed = matchedRules.some((r) => data.allowIds.get(r.rulesetId)?.has(r.ruleId));
            out.push(matchedRules.length > 0 && !isAllowed);
          } catch {
            out.push(false);
          }
        }
        return out;
      })());
    default:
      return false;
  }
});
