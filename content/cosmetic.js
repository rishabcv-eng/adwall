// Runs in every frame: applies per-site custom filters from the element zapper
// and removes "please disable your ad blocker" walls.
(() => {
  if (window.__adwallCosmetic) return;
  window.__adwallCosmetic = true;

  const host = location.hostname;
  const style = document.createElement("style");
  style.id = "adwall-custom";

  function renderCustom(customFilters = {}) {
    const selectors = customFilters[host] || [];
    style.textContent = selectors.length ? `${selectors.join(",\n")} { display: none !important; }` : "";
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  chrome.storage.local.get("customFilters").then(({ customFilters }) => renderCustom(customFilters));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.customFilters) renderCustom(changes.customFilters.newValue);
  });

  // --- Procedural filters (:has-text, :upward, :remove, ...) from the lists ---
  function textMatcher(arg) {
    const m = /^\/(.+)\/([imsu]*)$/.exec(arg);
    if (m) {
      try { const re = new RegExp(m[1], m[2]); return (s) => re.test(s); } catch { return () => false; }
    }
    return (s) => s.includes(arg);
  }

  function compileOp(name, arg) {
    switch (name) {
      case "has-text": {
        const test = textMatcher(arg);
        return { filter: (nodes) => nodes.filter((n) => test(n.textContent)) };
      }
      case "min-text-length": {
        const min = Number(arg) || 0;
        return { filter: (nodes) => nodes.filter((n) => n.textContent.length >= min) };
      }
      case "upward": {
        const steps = /^\d+$/.test(arg) ? Number(arg) : 0;
        return {
          filter: (nodes) => [...new Set(nodes.map((n) => {
            if (!steps) return n.parentElement?.closest(arg) || null;
            let p = n;
            for (let i = 0; i < steps && p; i++) p = p.parentElement;
            return p;
          }).filter(Boolean))],
        };
      }
      case "matches-css": {
        const i = arg.indexOf(":");
        if (i === -1) return null;
        const prop = arg.slice(0, i).trim();
        const test = textMatcher(arg.slice(i + 1).trim());
        return { filter: (nodes) => nodes.filter((n) => test(getComputedStyle(n).getPropertyValue(prop))) };
      }
      case "remove":
        return { action: (n) => n.remove() };
      case "remove-attr": {
        const test = textMatcher(arg);
        return { action: (n) => { for (const a of [...n.attributes]) if (test(a.name)) n.removeAttribute(a.name); } };
      }
      case "remove-class": {
        const test = textMatcher(arg);
        return { action: (n) => { for (const c of [...n.classList]) if (test(c)) n.classList.remove(c); } };
      }
      default:
        return null;
    }
  }

  function runProcedural(specs) {
    const compiled = specs
      .map(([base, ops]) => ({ base: base || "*", ops: ops.map(([name, arg]) => compileOp(name, arg)) }))
      .filter((spec) => spec.ops.every(Boolean));
    if (!compiled.length) return;

    const hide = (n) => n.style.setProperty("display", "none", "important");
    const apply = () => {
      for (const { base, ops } of compiled) {
        let nodes;
        try { nodes = [...document.querySelectorAll(base)]; } catch { continue; }
        let action = hide;
        for (const op of ops) {
          if (op.action) action = op.action;
          else nodes = op.filter(nodes);
          if (!nodes.length) break;
        }
        for (const n of nodes) action(n);
      }
    };

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; apply(); }, 100);
    };
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }

  chrome.runtime.sendMessage({ type: "procedural" }).then((specs) => {
    if (Array.isArray(specs) && specs.length) runProcedural(specs);
  }).catch(() => {});

  // --- Collapse the empty boxes blocked ads leave behind ---------------------
  // The background page confirms each element's URL really is blocked, so a
  // genuinely broken image on a normal site is never hidden.
  const ERROR_TYPES = { IMG: "image", EMBED: "object", OBJECT: "object", VIDEO: "media", AUDIO: "media" };
  const queue = [];
  const seen = new WeakSet();
  let queueTimer = null;

  function enqueue(el, kind) {
    const url = el.currentSrc || el.src || el.data || "";
    if (!/^https?:/.test(url) || seen.has(el)) return;
    seen.add(el);
    queue.push({ el, url, kind });
    queueTimer ??= setTimeout(flushQueue, 250);
  }

  async function flushQueue() {
    queueTimer = null;
    const batch = queue.splice(0, 40);
    if (!batch.length) return;
    try {
      const blocked = await chrome.runtime.sendMessage({
        type: "wouldBlock",
        items: batch.map(({ url, kind }) => ({ url, kind })),
      });
      if (!Array.isArray(blocked)) return;
      batch.forEach(({ el }, i) => { if (blocked[i]) collapse(el); });
    } catch {}
    if (queue.length) queueTimer ??= setTimeout(flushQueue, 250);
  }

  function collapse(el) {
    el.style.setProperty("display", "none", "important");
    // Hide a wrapper that exists only to hold this ad.
    let parent = el.parentElement;
    for (let depth = 0; depth < 2 && parent && parent !== document.body; depth++) {
      if (parent.children.length !== 1 || parent.textContent.trim()) break;
      parent.style.setProperty("display", "none", "important");
      parent = parent.parentElement;
    }
  }

  function watchForBlockedBoxes() {
    addEventListener("error", (e) => {
      const el = e.target;
      if (el instanceof Element && ERROR_TYPES[el.tagName]) enqueue(el, ERROR_TYPES[el.tagName]);
    }, true);
    // Blocked iframes do not fire an error event, so check them as they appear.
    const scan = (root) => {
      for (const frame of root.querySelectorAll?.("iframe[src]") || []) enqueue(frame, "sub_frame");
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IFRAME" && node.src) enqueue(node, "sub_frame");
          else scan(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    scan(document);
  }

  chrome.storage.local.get({ features: {} }).then(({ features }) => {
    if (features.collapse !== false) watchForBlockedBoxes();
  });

  // --- Anti-adblock walls ----------------------------------------------------
  const MENTIONS_BLOCKER = /ad[\s-]?block/i;
  const ASKS_TO_DISABLE = /disable|turn off|pause|whitelist|allowlist|allow ads|support us/i;

  function isWall(el) {
    const text = el.textContent;
    if (!text || text.length > 3000 || !MENTIONS_BLOCKER.test(text) || !ASKS_TO_DISABLE.test(text)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "absolute") return false;
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height > innerWidth * innerHeight * 0.25;
  }

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === "hidden") el.style.setProperty("overflow", "auto", "important");
    }
  }

  function sweep(nodes) {
    let removed = false;
    for (const node of nodes) {
      if (node.nodeType === 1 && node.isConnected && isWall(node)) {
        node.remove();
        removed = true;
      }
    }
    if (removed) unlockScroll();
  }

  let pending = [];
  let scheduled = false;
  new MutationObserver((mutations) => {
    for (const m of mutations) pending.push(...m.addedNodes);
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const batch = pending;
      pending = [];
      sweep(batch);
    }, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
