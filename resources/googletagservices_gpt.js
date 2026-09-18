// AdWall stand-in for Google Publisher Tag (googletag): every call succeeds, no ads load.
(function () {
  const noop = function () {};
  const returnThis = function () { return this; };
  const returnArray = () => [];
  const returnNull = () => null;

  function Slot(path, id) {
    this._path = path || "";
    this._id = id || "";
  }
  for (const m of ["addService", "clearCategoryExclusions", "clearTargeting", "defineSizeMapping", "setClickUrl",
    "setCategoryExclusion", "setCollapseEmptyDiv", "setForceSafeFrame", "setSafeFrameConfig", "setTargeting",
    "updateTargetingFromMap", "setConfig"]) Slot.prototype[m] = returnThis;
  Object.assign(Slot.prototype, {
    getAdUnitPath() { return this._path; },
    getSlotElementId() { return this._id; },
    getTargeting: returnArray, getTargetingKeys: returnArray, getSizes: returnArray,
    getCategoryExclusions: returnArray, getResponseInformation: returnNull, getAttribute: returnNull,
    getConfig: returnNull,
  });

  const service = {};
  for (const m of ["addEventListener", "removeEventListener", "clear", "clearCategoryExclusions",
    "clearTagForChildDirectedTreatment", "clearTargeting", "collapseEmptyDivs", "disableInitialLoad", "display",
    "enableAsyncRendering", "enableLazyLoad", "enableSingleRequest", "enableSyncRendering", "enableVideoAds",
    "refresh", "set", "setCategoryExclusion", "setCentering", "setCookieOptions", "setForceSafeFrame",
    "setLocation", "setPrivacySettings", "setPublisherProvidedId", "setRequestNonPersonalizedAds",
    "setSafeFrameConfig", "setTagForChildDirectedTreatment", "setTargeting", "setVideoContent",
    "updateCorrelator", "setConfig"]) service[m] = function () { return service; };
  Object.assign(service, { get: returnNull, getAttributeKeys: returnArray, getSlots: returnArray,
    getTargeting: returnArray, getTargetingKeys: returnArray, definePassback: () => new Slot(),
    defineOutOfPagePassback: () => new Slot() });

  const sizeMapping = { addSize() { return sizeMapping; }, build: returnArray };

  const cmd = {
    push(...fns) {
      for (const fn of fns) {
        try { if (typeof fn === "function") fn.call(window); } catch {}
      }
      return 1;
    },
  };

  const gt = window.googletag || {};
  const pending = Array.isArray(gt.cmd) ? gt.cmd : [];
  Object.assign(gt, {
    apiReady: true, pubadsReady: true, cmd,
    pubads: () => service, companionAds: () => service, content: () => service,
    defineSlot: (path, _size, id) => new Slot(path, id),
    defineOutOfPageSlot: (path, id) => new Slot(path, typeof id === "string" ? id : ""),
    destroySlots: noop, disablePublisherConsole: noop, display: noop, enableServices: noop,
    getVersion: () => "", openConsole: noop, setAdIframeTitle: noop, setConfig: noop, getConfig: returnNull,
    sizeMapping: () => sizeMapping,
    secureSignalProviders: { push: noop, clearAllCache: noop },
    enums: { OutOfPageFormat: { REWARDED: 4, TOP_ANCHOR: 2, BOTTOM_ANCHOR: 3, INTERSTITIAL: 5, LEFT_SIDE_RAIL: 6, RIGHT_SIDE_RAIL: 7 } },
  });
  window.googletag = gt;
  cmd.push(...pending);
})();
