// AdWall stand-in for AdSense's adsbygoogle.js.
(function () {
  window.adsbygoogle = { loaded: true, push() {} };
  const mark = () => {
    for (const ins of document.querySelectorAll("ins.adsbygoogle")) ins.setAttribute("data-adsbygoogle-status", "done");
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark, { once: true });
  else mark();
})();
