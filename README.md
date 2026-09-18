# AdWall

An ad blocker extension for Chrome, Edge and Brave (Manifest V3), built from the same
filter lists the major blockers use, with its own compiler, scriptlet engine and dashboard.

## What it does

| Layer | How it works |
|---|---|
| **Network blocking** | 20,000+ rules covering ~105,000 ad/tracker domains, compiled from EasyList, EasyPrivacy, uBlock Origin's filters and Peter Lowe's list — including path rules, per-site rules, exceptions and `important` overrides |
| **Stand-in scripts** | 820 redirect rules swap ad scripts (Google Ads, GTM, Analytics, GPT, apstag, IMA video ads…) for harmless stubs, so blocking doesn't break the page |
| **Element hiding** | 13,887 site-wide hiding rules + per-site CSS for 11,297 sites, with generic-exception and `$generichide` handling |
| **Procedural filters** | `:has-text()`, `:upward()`, `:remove()`, `:matches-css()` and friends for ads that plain CSS can't catch |
| **Scriptlets** | 36 scriptlet types applied across 32,700 site filters — the anti-anti-adblock layer (`set-constant`, `abort-on-property-read`, `json-prune`, `no-fetch-if`, `nowoif`, …) |
| **YouTube** | Ad data is pruned from the player response before playback; anything that still starts is muted, fast-forwarded and skipped. The "ad blockers are not allowed" dialog is removed |
| **Popups & popunders** | `window.open` without a real click, or to a known popunder network, is refused |
| **Collapsing** | The empty box a blocked ad leaves is removed — and only after the background page confirms that exact URL was blocked, so broken images on normal sites stay put |
| **Cookie banners** *(optional)* | 2,013 blocking rules + 15,281 hiding rules for consent notices, newsletter popups and chat widgets |
| **Sponsor segments** *(optional)* | Skips in-video sponsor/self-promo segments using SponsorBlock |
| **Auto-updating filters** | Twice a day AdWall re-downloads the lists and applies new domains and hiding rules itself — no rebuild, no extension update |
| **Element zapper** | Click anything that slipped through; it stays hidden on that site |
| **Dashboard** | Live counts, 14-day chart, most-blocked servers, feature switches, paused sites |

## Install

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `adblocker` folder.
4. Pin the red icon. The badge shows how many requests were blocked on the current tab.

## Using it

- **Toolbar popup**: on/off everywhere, pause this site, block cookie banners, zap an element, open the dashboard.
- **Dashboard** (popup → *Dashboard & settings*, or the extension's Details → Extension options): statistics, feature switches, filter status, **Update filters now**, paused sites, zapped elements, reset.

## Rebuilding the filters

Auto-update keeps domains and hiding rules current on its own. A rebuild is only needed to pick
up new *scriptlets* (those ship as code) or new list sources:

```bash
python tools/build.py
```

Then press the reload icon on AdWall's card in `chrome://extensions`.

## Privacy

- No accounts, no telemetry, no data ever sent about your browsing.
- Statistics stay on your machine in extension storage.
- **Auto-update** downloads filter lists from their publishers (easylist.to, ublockorigin.github.io, pgl.yoyo.org).
- **Sponsor skipping** (off by default) sends only the first 4 characters of a SHA-256 hash of the video id to sponsor.ajay.app, which returns ~80 videos sharing that prefix; the service never learns which video you're watching.

## How it's built

```
manifest.json            extension manifest (MV3)
background.js            rules, content scripts, stats, auto-update, SponsorBlock proxy
rules/                   compiled output: lists.json, generic.css, cosmetic.json, annoyances.*
scriptlets/src/*.js      scriptlet implementations (hand-written)
scriptlets/runtime.js    concatenated runtime (generated)
scriptlets/gen/*.js      per-scriptlet host→arguments data (generated)
resources/               stand-in scripts and transparent images used by redirect rules
content/                 cosmetic.js (hiding, procedural, collapsing, anti-adblock walls),
                         popup-guard.js, youtube.js, picker.js (element zapper)
popup/, options/         toolbar popup and dashboard
tools/                   build.py, network.py, cosmetic.py, lists.py, make_icons.py
```

`tools/build.py` downloads the lists and compiles them: `network.py` turns Adblock Plus syntax
(patterns, options, `domain=`, `redirect=`, `important`, `badfilter`) into declarativeNetRequest
rules; `cosmetic.py` splits hiding rules into generic, per-site, procedural and scriptlet data.

## Honest limitations

- **Chrome's MV3 rules apply to every blocker on Chrome.** Firefox + uBlock Origin is still the
  strongest possible setup, because uBO there can filter responses as they stream.
- **YouTube changes its ad delivery often.** The scriptlet layer follows uBlock's filters, but a
  new trick can work for a while until the lists catch up — rerun `tools/build.py` when that happens.
- **Facebook/Instagram sponsored posts** are woven into the page itself and are not blocked.
- **Auto-update can't add new scriptlets**, only domains and hiding rules; scriptlets need a rebuild.
- If a site misbehaves, pause AdWall on it from the popup — that's one click and a reload.

## License

GPL-3.0. The compiled filter data in `rules/` and `scriptlets/gen/` is derived from
EasyList and uBlock Origin's filter lists, so the whole project is distributed under
the GPL to stay compatible with them.

## Credits

Filter lists by the EasyList authors, the uBlock Origin project (uAssets), Peter Lowe and the
SponsorBlock community. Those lists are licensed GPLv3 / CC BY-SA 3.0 by their authors; this
project compiles them at build time and ships the result for personal use.
