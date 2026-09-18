// Shared helpers for scriptlets. All source files are concatenated into one
// IIFE (scriptlets/runtime.js) that runs in the page's MAIN world at document_start.

const SCRIPTLETS = Object.create(null);
const ABORT_MAGIC = "AdWall" + Math.random().toString(36).slice(2);

const natives = {
  defineProperty: Object.defineProperty,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  fnToString: Function.prototype.toString,
  JSONparse: JSON.parse,
  JSONstringify: JSON.stringify,
  fetch: self.fetch,
  setTimeout: self.setTimeout,
  setInterval: self.setInterval,
};

// "/regex/flags" -> RegExp, "" -> match everything, otherwise literal substring.
function patternToRegex(pattern, flags = "") {
  if (pattern === undefined || pattern === "" || pattern === "*") return /^/;
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (m) {
    try { return new RegExp(m[1], m[2] || flags); } catch { return /(?!)/; }
  }
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
}

// uBO needles may be negated with a leading "!".
function needleMatcher(needle) {
  let negate = false;
  if (typeof needle === "string" && needle.startsWith("!")) {
    negate = true;
    needle = needle.slice(1);
  }
  const re = patternToRegex(needle);
  return (text) => re.test(String(text)) !== negate;
}

function fnText(fn) {
  try { return typeof fn === "function" ? natives.fnToString.call(fn) : String(fn); } catch { return ""; }
}

// Make a replacement function look native to anti-adblock toString() checks.
function disguise(fake, real) {
  try {
    natives.defineProperty(fake, "toString", { value: () => natives.fnToString.call(real), configurable: true, writable: true });
    natives.defineProperty(fake, "name", { value: real.name, configurable: true });
  } catch {}
  return fake;
}

function throwAbort() {
  throw new ReferenceError(ABORT_MAGIC);
}

// Swallow our own abort errors so they don't show up as page errors.
self.addEventListener("error", (e) => {
  if (String(e.message || e.error?.message).includes(ABORT_MAGIC)) e.preventDefault();
}, true);

const noopFunc = function () {};
const CONSTANTS = {
  undefined: undefined, false: false, true: true, null: null, "''": "", "": "",
  noopFunc, trueFunc: () => true, falseFunc: () => false, throwFunc: throwAbort,
  emptyObj: {}, emptyArr: [], "{}": {}, "[]": [], emptyStr: "", noopCallbackFunc: () => noopFunc,
  "-1": -1, yes: "yes", no: "no", on: "on", off: "off", accept: "accept", reject: "reject",
};

// Returns [ok, value]. Only a safe set of values is allowed for untrusted lists.
function constantValue(raw) {
  if (Object.prototype.hasOwnProperty.call(CONSTANTS, raw)) {
    const v = CONSTANTS[raw];
    return [true, v instanceof Object && typeof v !== "function" ? (Array.isArray(v) ? [] : {}) : v];
  }
  if (/^-?\d+$/.test(raw) && Math.abs(Number(raw)) <= 0x7fff) return [true, Number(raw)];
  return [false];
}

// Walks "a.b.c" on window. Calls onFinal(owner, prop) when the owner of the last
// property exists, installing setters along the way so later assignments are caught.
function trapChain(chain, onFinal, root = self) {
  const trap = (owner, parts) => {
    const prop = parts[0];
    if (parts.length === 1) {
      onFinal(owner, prop);
      return;
    }
    let current = owner[prop];
    if (current instanceof Object) {
      trap(current, parts.slice(1));
      return;
    }
    const desc = natives.getOwnPropertyDescriptor(owner, prop);
    if (desc && desc.configurable === false) return;
    try {
      natives.defineProperty(owner, prop, {
        configurable: true,
        get: () => current,
        set: (v) => {
          current = v;
          if (v instanceof Object) trap(v, parts.slice(1));
        },
      });
    } catch {}
  };
  trap(root, chain.split("."));
}

// "url:/ads/ method:POST" style property matching used by fetch/xhr scriptlets.
function parsePropsToMatch(raw) {
  const props = new Map();
  if (!raw || raw === "*") return props;
  for (const token of raw.split(/\s+/)) {
    const i = token.indexOf(":");
    if (i === -1 || /^https?$/.test(token.slice(0, i))) props.set("url", needleMatcher(token));
    else props.set(token.slice(0, i), needleMatcher(token.slice(i + 1)));
  }
  return props;
}

function propsMatch(props, details) {
  for (const [key, test] of props) {
    if (!test(details[key] ?? "")) return false;
  }
  return true;
}

function requestDetails(resource, init) {
  const details = {};
  if (resource instanceof Request) {
    for (const k of ["url", "method", "mode", "credentials", "referrer", "body"]) details[k] = resource[k];
  } else {
    details.url = String(resource);
  }
  if (init && typeof init === "object") {
    for (const k of Object.keys(init)) details[k] = typeof init[k] === "string" ? init[k] : "";
  }
  return details;
}

// Run callback now and on every DOM change until the page is done (or forever).
function onDomChange(callback, stopAfterLoad = false) {
  const run = () => { try { callback(); } catch {} };
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    natives.setTimeout.call(self, () => { pending = false; run(); }, 0);
  });
  const start = () => {
    run();
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  };
  if (document.documentElement) start();
  else natives.setTimeout.call(self, start, 0);
  if (stopAfterLoad) self.addEventListener("load", () => natives.setTimeout.call(self, () => observer.disconnect(), 2000));
}
