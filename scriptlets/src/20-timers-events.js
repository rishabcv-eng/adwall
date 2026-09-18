// Scriptlets that neutralize timers, eval, event listeners and popups.

function wrapTimer(name, shouldBlock, adjustDelay) {
  const real = self[name];
  const fake = disguise(function (callback, delay, ...rest) {
    const text = fnText(callback);
    if (shouldBlock && shouldBlock(text, delay)) callback = noopFunc;
    if (adjustDelay) delay = adjustDelay(text, delay);
    return real.call(this, callback, delay, ...rest);
  }, real);
  self[name] = fake;
}

function delayMatcher(raw) {
  if (raw === undefined || raw === "" || raw === "*") return () => true;
  const negate = raw.startsWith("!");
  const n = Number(negate ? raw.slice(1) : raw);
  return (delay) => (Number(delay) === n) !== negate;
}

// nostif / no-setTimeout-if, nosiif / no-setInterval-if
for (const [scriptlet, timer] of [["nostif", "setTimeout"], ["nosiif", "setInterval"]]) {
  SCRIPTLETS[scriptlet] = (needle = "", delay) => {
    const matches = needleMatcher(needle);
    const delayOk = delayMatcher(delay);
    wrapTimer(timer, (text, d) => matches(text) && delayOk(d));
  };
}

// nano-stb / adjust-setTimeout, nano-sib / adjust-setInterval: speed up countdowns.
for (const [scriptlet, timer] of [["nano-stb", "setTimeout"], ["nano-sib", "setInterval"]]) {
  SCRIPTLETS[scriptlet] = (needle = "", delay = "1000", boost = "0.05") => {
    const matches = needleMatcher(needle);
    const target = delay === "*" ? null : Number(delay);
    let factor = Number(boost);
    if (!Number.isFinite(factor)) factor = 0.05;
    factor = Math.min(50, Math.max(0.001, factor));
    wrapTimer(timer, null, (text, d) => (matches(text) && (target === null || Number(d) === target) ? d * factor : d));
  };
}

// noeval-if / prevent-eval-if, noeval
SCRIPTLETS["noeval-if"] = (needle = "") => {
  const matches = needleMatcher(needle);
  const real = self.eval;
  self.eval = disguise(function (code) {
    if (matches(String(code))) return undefined;
    return real.call(self, code);
  }, real);
};
SCRIPTLETS["noeval"] = () => SCRIPTLETS["noeval-if"]("");

// aeld / prevent-addEventListener
SCRIPTLETS["aeld"] = (type = "", needle = "") => {
  const typeMatches = needleMatcher(type);
  const handlerMatches = needleMatcher(needle);
  const proto = EventTarget.prototype;
  const real = proto.addEventListener;
  proto.addEventListener = disguise(function (evType, handler, ...rest) {
    let text = "";
    try {
      text = typeof handler === "function" ? fnText(handler) : fnText(handler?.handleEvent);
    } catch {}
    if (typeMatches(evType) && handlerMatches(text)) return undefined;
    return real.call(this, evType, handler, ...rest);
  }, real);
};

// nowoif / no-window-open-if: refuse popups, returning a harmless fake window.
SCRIPTLETS["nowoif"] = (needle = "") => {
  const matches = needleMatcher(needle);
  const real = self.open;
  const fakeWindow = () => {
    const w = { closed: false, opener: self, location: { href: "" }, document: { write() {}, close() {} } };
    w.close = () => { w.closed = true; };
    w.focus = w.blur = w.postMessage = noopFunc;
    w.window = w.self = w;
    return w;
  };
  self.open = disguise(function (url, ...rest) {
    if (matches(url === undefined ? "" : String(url))) return fakeWindow();
    return real.call(this, url, ...rest);
  }, real);
};

// nowebrtc: WebRTC is abused to route ads around blockers.
SCRIPTLETS["nowebrtc"] = () => {
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    const real = self[name];
    if (typeof real !== "function") continue;
    const Fake = function () {
      return {
        close: noopFunc, createDataChannel: noopFunc, addEventListener: noopFunc, removeEventListener: noopFunc,
        createOffer: () => Promise.reject(new DOMException("", "NotAllowedError")),
        setLocalDescription: () => Promise.resolve(), setRemoteDescription: () => Promise.resolve(),
      };
    };
    self[name] = disguise(Fake, real);
  }
};

// refresh-defuser: stop <meta http-equiv=refresh> redirects to ad pages.
SCRIPTLETS["refresh-defuser"] = () => {
  const run = () => {
    for (const meta of document.querySelectorAll('meta[http-equiv="refresh" i]')) meta.remove();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
};
