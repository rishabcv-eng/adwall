// Element zapper, injected on demand from the popup. Hover to highlight,
// click to block that element on this site permanently, Esc to cancel.
(() => {
  if (window.__adwallPicker) return;
  window.__adwallPicker = true;

  const highlight = document.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed", zIndex: 2147483647, pointerEvents: "none",
    background: "rgba(229,72,77,.25)", outline: "2px solid #e5484d", borderRadius: "3px",
    transition: "all 60ms ease-out",
  });

  const banner = document.createElement("div");
  banner.textContent = "AdWall: click an element to block it · Esc to cancel";
  Object.assign(banner.style, {
    position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647,
    background: "#18181b", color: "#fafafa", font: "600 13px/1.4 system-ui, sans-serif",
    padding: "8px 14px", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,.35)", pointerEvents: "none",
  });

  document.documentElement.append(highlight, banner);

  let target = null;

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.documentElement || el === document.body) return;
    target = el;
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  function selectorFor(el) {
    const parts = [];
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node.id && !/\d{3,}/.test(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
      } else {
        let part = node.localName;
        const classes = [...node.classList].filter((c) => !/\d{3,}|hover|active|focus/.test(c)).slice(0, 3);
        part += classes.map((c) => `.${CSS.escape(c)}`).join("");
        const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.localName === node.localName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        parts.unshift(part);
      }
      const selector = parts.join(" > ");
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    return parts.join(" > ");
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!target) return;
    const selector = selectorFor(target);
    target.style.setProperty("display", "none", "important");
    cleanup();

    const host = location.hostname;
    const { customFilters = {} } = await chrome.storage.local.get("customFilters");
    customFilters[host] = [...new Set([...(customFilters[host] || []), selector])];
    await chrome.storage.local.set({ customFilters });
  }

  function onKey(e) {
    if (e.key === "Escape") cleanup();
  }

  function cleanup() {
    removeEventListener("mousemove", onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
    highlight.remove();
    banner.remove();
    window.__adwallPicker = false;
  }

  addEventListener("mousemove", onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("keydown", onKey, true);
})();
