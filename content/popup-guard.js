// Runs in the page's own JS world: stops popups/popunders opened without a real
// user click, and any window.open to a known popunder network.
(() => {
  const AD_HOSTS = /(^|\.)(popads\.net|popcash\.net|propellerads\.com|propellerclick\.com|adsterra\.com|exoclick\.com|exosrv\.com|juicyads\.com|hilltopads\.net|adcash\.com|onclickads\.net|onclkds\.com|clickadu\.com|ad-maven\.com|trafficstars\.com|tsyndicate\.com|monetag\.com|galaksion\.com|evadav\.com|clickaine\.com|realsrv\.com|pemsrv\.com)$/i;

  const nativeOpen = window.open;

  function open(url, ...rest) {
    let targetHost = "";
    try {
      targetHost = new URL(url, location.href).hostname;
    } catch {}
    const userClicked = navigator.userActivation ? navigator.userActivation.isActive : true;

    if (!userClicked || AD_HOSTS.test(targetHost)) {
      console.debug("[AdWall] blocked popup:", url);
      return null;
    }
    return nativeOpen.call(this, url, ...rest);
  }

  open.toString = Function.prototype.toString.bind(nativeOpen);
  window.open = open;
})();
