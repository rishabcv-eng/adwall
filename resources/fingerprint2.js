// AdWall stand-in for fingerprintjs2: returns a random, non-identifying hash.
(function () {
  const hash = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const later = (fn, ...args) => { if (typeof fn === "function") setTimeout(() => fn(...args), 1); };
  const Fingerprint2 = function () {};
  Fingerprint2.prototype.get = function (callback) { later(callback, hash, []); };
  Fingerprint2.get = (options, callback) => later(typeof options === "function" ? options : callback, []);
  Fingerprint2.getPromise = () => Promise.resolve([]);
  Fingerprint2.getV18 = (options, callback) => later(typeof options === "function" ? options : callback, hash, []);
  Fingerprint2.x64hash128 = () => hash;
  window.Fingerprint2 = Fingerprint2;
})();
