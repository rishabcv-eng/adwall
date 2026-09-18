// AdWall stand-in for Google Tag Manager: pages that wait for GTM callbacks keep working.
(function () {
  const noop = function () {};
  const w = window;
  const runCallback = (item) => {
    if (item && typeof item.eventCallback === "function") setTimeout(item.eventCallback, 1);
  };
  const dl = w.dataLayer;
  if (Array.isArray(dl)) {
    dl.forEach(runCallback);
    const push = dl.push;
    dl.push = function (...items) {
      items.forEach(runCallback);
      return push.apply(this, items);
    };
    if (dl.hide && typeof dl.hide.end === "function") {
      dl.hide.end();
      dl.hide.end = noop;
    }
  }
  if (typeof w.google_tag_manager !== "object") w.google_tag_manager = {};
})();
