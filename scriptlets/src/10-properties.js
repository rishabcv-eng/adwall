// Scriptlets that trap global properties.

// set / set-constant: force window.a.b.c to a constant value.
SCRIPTLETS["set"] = (chain, raw, ...extra) => {
  if (!chain) return;
  const [ok, value] = constantValue(raw);
  if (!ok) return;
  applyConstant(chain, value, extra);
};

// trusted-set: arbitrary JSON value, only emitted from trusted lists.
SCRIPTLETS["trusted-set"] = (chain, raw) => {
  if (!chain) return;
  let value;
  try {
    const parsed = natives.JSONparse(raw);
    value = parsed && typeof parsed === "object" && "value" in parsed ? parsed.value : parsed;
  } catch {
    const [ok, v] = constantValue(raw);
    if (!ok) return;
    value = v;
  }
  applyConstant(chain, value, []);
};

function applyConstant(chain, value, extra) {
  const asCallback = extra.includes("asCallback");
  const final = asCallback ? () => value : value;
  trapChain(chain, (owner, prop) => {
    const desc = natives.getOwnPropertyDescriptor(owner, prop);
    if (desc && desc.configurable === false) {
      try { owner[prop] = final; } catch {}
      return;
    }
    try {
      natives.defineProperty(owner, prop, {
        configurable: true,
        enumerable: desc ? desc.enumerable : true,
        get: () => final,
        set: () => {},
      });
    } catch {}
  });
}

// aopr / abort-on-property-read
SCRIPTLETS["aopr"] = (chain) => {
  if (!chain) return;
  trapChain(chain, (owner, prop) => {
    try { natives.defineProperty(owner, prop, { configurable: true, get: throwAbort, set() {} }); } catch {}
  });
};

// aopw / abort-on-property-write
SCRIPTLETS["aopw"] = (chain) => {
  if (!chain) return;
  trapChain(chain, (owner, prop) => {
    try {
      const desc = natives.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.configurable === false) return;
      natives.defineProperty(owner, prop, { configurable: true, set: throwAbort });
    } catch {}
  });
};

// acs / abort-current-script: abort when a script whose text or src matches
// the needle touches the property.
SCRIPTLETS["acs"] = (chain, needle = "", context = "") => {
  if (!chain) return;
  const matches = needleMatcher(needle);
  const contextMatches = needleMatcher(context);
  const scriptText = () => {
    const s = document.currentScript;
    if (!(s instanceof HTMLScriptElement)) return null;
    return s.src ? s.src : s.textContent;
  };
  const check = () => {
    const text = scriptText();
    if (text !== null && matches(text) && contextMatches(text)) throwAbort();
  };
  trapChain(chain, (owner, prop) => {
    const desc = natives.getOwnPropertyDescriptor(owner, prop);
    if (desc && desc.configurable === false) return;
    let value = owner[prop];
    const getter = desc?.get;
    const setter = desc?.set;
    try {
      natives.defineProperty(owner, prop, {
        configurable: true,
        get() { check(); return getter ? getter.call(this) : value; },
        set(v) { check(); if (setter) setter.call(this, v); else value = v; },
      });
    } catch {}
  });
};

// aost / abort-on-stack-trace
SCRIPTLETS["aost"] = (chain, needle = "") => {
  if (!chain) return;
  const matches = needleMatcher(needle);
  const check = () => {
    if (matches(new Error().stack || "")) throwAbort();
  };
  trapChain(chain, (owner, prop) => {
    const desc = natives.getOwnPropertyDescriptor(owner, prop);
    if (desc && desc.configurable === false) return;
    let value = owner[prop];
    try {
      natives.defineProperty(owner, prop, {
        configurable: true,
        get() { check(); return desc?.get ? desc.get.call(this) : value; },
        set(v) { check(); if (desc?.set) desc.set.call(this, v); else value = v; },
      });
    } catch {}
  });
};

// nofab / fuckadblock defuser: fake detector libraries that never detect.
SCRIPTLETS["nofab"] = () => {
  const Fake = function () {};
  Fake.prototype = {
    check() { return false; }, clearEvent() {}, emitEvent() {},
    on(detected, cb) { if (!detected && typeof cb === "function") natives.setTimeout.call(self, cb, 1); return this; },
    onDetected() { return this; },
    onNotDetected(cb) { if (typeof cb === "function") natives.setTimeout.call(self, cb, 1); return this; },
    setOption() { return this; },
    options: { set() { return this; }, get() { return this; } },
  };
  const instance = new Fake();
  for (const name of ["FuckAdBlock", "BlockAdBlock", "SniffAdBlock"]) {
    try { natives.defineProperty(self, name, { value: Fake, configurable: true }); } catch {}
  }
  for (const name of ["fuckAdBlock", "blockAdBlock", "sniffAdBlock"]) {
    try { natives.defineProperty(self, name, { value: instance, configurable: true }); } catch {}
  }
};

// popads-dummy: satisfy PopAds checks without loading anything.
SCRIPTLETS["popads-dummy"] = () => {
  try {
    natives.defineProperty(self, "PopAds", { value: {}, configurable: true });
    natives.defineProperty(self, "popns", { value: {}, configurable: true });
  } catch {}
};
