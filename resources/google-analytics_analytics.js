// AdWall stand-in for analytics.js: runs hit callbacks, sends nothing.
(function () {
  const noop = function () {};
  const Tracker = function () {};
  Tracker.prototype.get = noop;
  Tracker.prototype.set = noop;
  Tracker.prototype.send = noop;

  const name = window.GoogleAnalyticsObject || "ga";
  const queue = window[name] && window[name].q;

  const ga = function (...args) {
    const last = args[args.length - 1];
    try {
      if (typeof last === "function") last(new Tracker());
      else if (last && typeof last === "object" && typeof last.hitCallback === "function") last.hitCallback();
    } catch {}
  };
  ga.create = () => new Tracker();
  ga.getByName = () => new Tracker();
  ga.getAll = () => [new Tracker()];
  ga.remove = noop;
  ga.loaded = true;
  window[name] = ga;

  if (Array.isArray(queue)) for (const args of queue) ga(...args);

  const dl = window.dataLayer;
  if (dl && dl.hide && typeof dl.hide.end === "function") {
    dl.hide.end();
    dl.hide.end = noop;
  }
})();
