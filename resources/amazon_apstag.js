// AdWall stand-in for Amazon's apstag.js: bid requests return no bids.
(function () {
  const noop = function () {};
  window.apstag = {
    _Q: [],
    init: noop,
    fetchBids(_config, callback) {
      if (typeof callback === "function") setTimeout(() => callback([]), 1);
    },
    setDisplayBids: noop,
    targetingKeys: () => [],
  };
})();
