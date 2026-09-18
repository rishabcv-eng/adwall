// AdWall stand-in for legacy ga.js (_gaq / _gat).
(function () {
  const noop = function () {};
  const tracker = new Proxy({}, { get: () => noop });
  window._gat = {
    _getTracker: () => tracker, _getTrackerByName: () => tracker, _createTracker: () => tracker,
    _anonymizeIp: noop, _forceSSL: noop,
  };
  const gaq = {
    push(...items) {
      for (const item of items) {
        try {
          if (typeof item === "function") item();
          else if (Array.isArray(item) && item[0] === "_set" && item[1] === "hitCallback" && typeof item[2] === "function") item[2]();
        } catch {}
      }
      return 0;
    },
  };
  const old = window._gaq;
  window._gaq = gaq;
  if (Array.isArray(old)) gaq.push(...old);
})();
