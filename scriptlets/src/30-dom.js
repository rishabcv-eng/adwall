// Scriptlets that edit the DOM: inline script text, attributes, classes, links.

function watchNodes(nodeName, onNode) {
  const nameMatches = needleMatcher(nodeName);
  const visit = (node) => {
    if (node.nodeType === 1 && nameMatches(node.nodeName.toLowerCase())) onNode(node);
    else if (node.nodeType === 3 && nameMatches("#text")) onNode(node);
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of m.addedNodes) visit(n);
  });
  // Parser-inserted scripts run after a microtask checkpoint, so this
  // observer sees (and can empty) inline scripts before they execute.
  const start = () => observer.observe(document, { childList: true, subtree: true });
  if (document.documentElement) start();
  else natives.setTimeout.call(self, start, 0);
  if (document.documentElement) {
    for (const n of document.querySelectorAll(nodeName.startsWith("/") ? "*" : nodeName || "*")) visit(n);
  }
}

// rmnt / remove-node-text
SCRIPTLETS["rmnt"] = (nodeName = "", needle = "") => {
  if (!nodeName) return;
  const matches = needleMatcher(needle);
  watchNodes(nodeName, (node) => {
    if (matches(node.textContent)) node.textContent = "";
  });
};

// rpnt / replace-node-text (and trusted-rpnt)
SCRIPTLETS["rpnt"] = (nodeName = "", pattern = "", replacement = "", ...extra) => {
  if (!nodeName || !pattern) return;
  const re = patternToRegex(pattern, "g");
  const conditionIndex = extra.indexOf("condition");
  const condition = conditionIndex !== -1 ? needleMatcher(extra[conditionIndex + 1]) : () => true;
  watchNodes(nodeName, (node) => {
    const text = node.textContent;
    if (!condition(text)) return;
    const replaced = text.replace(re, replacement);
    if (replaced !== text) node.textContent = replaced;
  });
};

function parseBehavior(raw) {
  return { stay: /stay/.test(raw || ""), complete: /complete/.test(raw || "") };
}

// ra / remove-attr
SCRIPTLETS["ra"] = (attrs = "", selector = "", behavior = "") => {
  const names = attrs.split(/\s*\|\s*/).filter(Boolean);
  if (!names.length) return;
  const sel = selector || names.map((a) => `[${CSS.escape(a)}]`).join(",");
  const { stay, complete } = parseBehavior(behavior);
  const run = () => {
    for (const el of document.querySelectorAll(sel)) for (const a of names) el.removeAttribute(a);
  };
  const go = () => (stay ? onDomChange(run) : onDomChange(run, true));
  if (complete && document.readyState !== "complete") self.addEventListener("load", go, { once: true });
  else go();
};

// rc / remove-class
SCRIPTLETS["rc"] = (classes = "", selector = "", behavior = "") => {
  const names = classes.split(/\s*\|\s*/).filter(Boolean);
  if (!names.length) return;
  const sel = selector || names.map((c) => `.${CSS.escape(c)}`).join(",");
  const { stay, complete } = parseBehavior(behavior);
  const run = () => {
    for (const el of document.querySelectorAll(sel)) el.classList.remove(...names);
  };
  const go = () => (stay ? onDomChange(run) : onDomChange(run, true));
  if (complete && document.readyState !== "complete") self.addEventListener("load", go, { once: true });
  else go();
};

// href-sanitizer: replace tracking/ad redirect links with their real destination.
SCRIPTLETS["href-sanitizer"] = (selector = "", source = "text") => {
  if (!selector) return;
  const extract = (a) => {
    if (source === "text") return a.textContent.trim();
    if (source.startsWith("?")) {
      try { return new URL(a.href, location.href).searchParams.get(source.slice(1)) || ""; } catch { return ""; }
    }
    if (source.startsWith("[") && source.endsWith("]")) return a.getAttribute(source.slice(1, -1)) || "";
    return "";
  };
  onDomChange(() => {
    for (const a of document.querySelectorAll(selector)) {
      const target = extract(a);
      if (!/^https?:\/\//.test(target)) continue;
      try { new URL(target); } catch { continue; }
      if (a.href !== target) a.setAttribute("href", target);
    }
  });
};
