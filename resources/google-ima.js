// AdWall stand-in for the Google IMA video ad SDK. Players load an "ads manager"
// that immediately reports all ads complete, so the actual video plays right away.
(function () {
  const noop = function () {};

  class Emitter {
    constructor() { this._listeners = new Map(); }
    addEventListener(types, fn) {
      for (const t of [].concat(types)) {
        if (!this._listeners.has(t)) this._listeners.set(t, new Set());
        this._listeners.get(t).add(fn);
      }
    }
    removeEventListener(types, fn) {
      for (const t of [].concat(types)) this._listeners.get(t)?.delete(fn);
    }
    _emit(type, event) {
      for (const fn of this._listeners.get(type) || []) {
        try { typeof fn === "function" ? fn(event) : fn.handleEvent?.(event); } catch {}
      }
    }
  }

  const AdEventType = {
    ALL_ADS_COMPLETED: "allAdsCompleted", CLICK: "click", COMPLETE: "complete", CONTENT_PAUSE_REQUESTED: "contentPauseRequested",
    CONTENT_RESUME_REQUESTED: "contentResumeRequested", DURATION_CHANGE: "durationChange", FIRST_QUARTILE: "firstQuartile",
    IMPRESSION: "impression", LOADED: "loaded", LOG: "log", MIDPOINT: "midpoint", PAUSED: "pause", RESUMED: "resume",
    SKIPPED: "skip", STARTED: "start", THIRD_QUARTILE: "thirdQuartile", USER_CLOSE: "userClose",
    VOLUME_CHANGED: "volumeChange", VOLUME_MUTED: "mute", AD_BREAK_READY: "adBreakReady", AD_METADATA: "adMetadata",
  };

  class AdsManager extends Emitter {
    init() {}
    start() {
      setTimeout(() => {
        this._emit(AdEventType.CONTENT_RESUME_REQUESTED, { type: AdEventType.CONTENT_RESUME_REQUESTED, getAd: () => null });
        this._emit(AdEventType.ALL_ADS_COMPLETED, { type: AdEventType.ALL_ADS_COMPLETED, getAd: () => null });
      }, 1);
    }
    destroy() {} discardAdBreak() {} pause() {} resume() {} resize() {} skip() {} stop() {} updateAdsRenderingSettings() {}
    collapse() {} expand() {} focus() {} clicked() {} configureAdsManager() {}
    getAdSkippableState() { return false; }
    getCuePoints() { return []; }
    getCurrentAd() { return null; }
    getRemainingTime() { return 0; }
    getVolume() { return 1; }
    setVolume() {}
    isCustomClickTrackingUsed() { return false; }
    isCustomPlaybackUsed() { return false; }
  }

  class AdsManagerLoadedEvent {
    constructor(manager, userRequestContext) {
      this.type = AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED;
      this._manager = manager;
      this._context = userRequestContext;
    }
    getAdsManager() { return this._manager; }
    getUserRequestContext() { return this._context || {}; }
  }
  AdsManagerLoadedEvent.Type = { ADS_MANAGER_LOADED: "adsManagerLoaded" };

  class AdsLoader extends Emitter {
    constructor() { super(); this._settings = new ImaSdkSettings(); }
    contentComplete() {}
    destroy() {}
    getSettings() { return this._settings; }
    getVersion() { return "3.600.0"; }
    requestAds(_request, userRequestContext) {
      setTimeout(() => {
        const event = new AdsManagerLoadedEvent(new AdsManager(), userRequestContext);
        this._emit(AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, event);
      }, 1);
    }
  }

  class ImaSdkSettings {
    constructor() {
      for (const m of ["setAutoPlayAdBreaks", "setCompanionBackfill", "setCookiesEnabled", "setDisableCustomPlaybackForIOS10Plus",
        "setFeatureFlags", "setLocale", "setNumRedirects", "setPlayerType", "setPlayerVersion", "setPpid",
        "setSessionId", "setVpaidAllowed", "setVpaidMode"]) this[m] = noop;
      this.getCompanionBackfill = () => "";
      this.getDisableCustomPlaybackForIOS10Plus = () => false;
      this.getFeatureFlags = () => ({});
      this.getLocale = () => "en";
      this.getNumRedirects = () => 0;
      this.getPlayerType = () => "";
      this.getPlayerVersion = () => "";
      this.getPpid = () => "";
      this.isCookiesEnabled = () => false;
      this.isVpaidAdapter = () => false;
    }
  }
  ImaSdkSettings.VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
  ImaSdkSettings.CompanionBackfillMode = { ALWAYS: "always", ON_MASTER_AD: "on_master_ad" };

  class AdDisplayContainer { initialize() {} destroy() {} }
  class AdsRequest { setAdWillAutoPlay() {} setAdWillPlayMuted() {} setContinuousPlayback() {} }
  class AdsRenderingSettings {}
  class AdError {
    getErrorCode() { return 1009; }
    getInnerError() { return null; }
    getMessage() { return "No ads"; }
    getType() { return "adLoadError"; }
    getVastErrorCode() { return 303; }
  }
  class AdErrorEvent { getError() { return new AdError(); } getUserRequestContext() { return {}; } }
  AdErrorEvent.Type = { AD_ERROR: "adError" };
  class AdEvent {}
  AdEvent.Type = AdEventType;

  window.google = window.google || {};
  window.google.ima = {
    AdDisplayContainer, AdError, AdErrorEvent, AdEvent, AdsLoader, AdsManager, AdsManagerLoadedEvent,
    AdsRenderingSettings, AdsRequest, ImaSdkSettings,
    CompanionAdSelectionSettings: class {},
    UiElements: { AD_ATTRIBUTION: "adAttribution", COUNTDOWN: "countdown" },
    ViewMode: { FULLSCREEN: "fullscreen", NORMAL: "normal" },
    OmidVerificationVendor: {}, settings: new ImaSdkSettings(), VERSION: "3.600.0",
  };
})();
