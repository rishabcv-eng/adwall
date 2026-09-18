// AdWall stand-in for FuckAdBlock / BlockAdBlock: always reports "no ad blocker".
(function () {
  const later = (fn) => { if (typeof fn === "function") setTimeout(fn, 1); };
  const Detector = function () {};
  Detector.prototype = {
    check() { return false; },
    clearEvent() {},
    emitEvent() { return this; },
    on(detected, fn) { if (!detected) later(fn); return this; },
    onDetected() { return this; },
    onNotDetected(fn) { later(fn); return this; },
    setOption() { return this; },
  };
  const instance = new Detector();
  window.FuckAdBlock = window.BlockAdBlock = Detector;
  window.fuckAdBlock = window.blockAdBlock = instance;
})();
