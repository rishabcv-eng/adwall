// YouTube: skip video ads the player still manages to start, and (optionally)
// skip in-video sponsor segments via SponsorBlock.
(() => {
  const SKIP_BUTTONS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
  ].join(",");

  let features = { youtubeAds: true, sponsorSkip: false };
  let saved = null;        // the viewer's mute/speed settings from before an ad
  let segments = [];       // sponsor segments for the current video
  let videoId = null;

  chrome.storage.local.get({ features: {} }).then((s) => {
    features = { ...features, ...s.features };
    refreshSegments();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.features) return;
    features = { ...features, ...changes.features.newValue };
    segments = [];
    videoId = null;
    refreshSegments();
  });

  const currentVideoId = () => new URLSearchParams(location.search).get("v");

  async function refreshSegments() {
    const id = currentVideoId();
    if (id === videoId) return;
    videoId = id;
    segments = [];
    if (!id || !features.sponsorSkip) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "sponsor", videoId: id });
      if (Array.isArray(result) && currentVideoId() === id) segments = result;
    } catch {}
  }

  function skipAds(player, video) {
    const adPlaying = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
    if (adPlaying) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      video.playbackRate = 16;
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
        video.currentTime = video.duration;
      }
      document.querySelectorAll(SKIP_BUTTONS).forEach((btn) => btn.click());
    } else if (saved) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
      saved = null;
    }
  }

  function skipSponsors(video) {
    if (!segments.length || video.paused) return;
    const t = video.currentTime;
    for (const seg of segments) {
      if (t >= seg.start && t < seg.end - 0.3) {
        video.currentTime = seg.end;
        break;
      }
    }
  }

  function tick() {
    refreshSegments();
    const player = document.querySelector("#movie_player");
    const video = player?.querySelector("video");
    if (!player || !video) return;

    if (features.youtubeAds) skipAds(player, video);
    if (features.sponsorSkip) skipSponsors(video);

    // "Ad blockers are not allowed" dialog: remove it and resume playback.
    const wall = document.querySelector("ytd-enforcement-message-view-model");
    if (wall) {
      wall.closest("tp-yt-paper-dialog")?.remove();
      document.querySelector("tp-yt-iron-overlay-backdrop")?.remove();
      if (video.paused) video.play().catch(() => {});
    }
  }

  setInterval(tick, 250);
})();
