"""Download filter lists (with a local cache) and run uBO's !#include / !#if preprocessor."""
import re
import urllib.parse
import urllib.request
from pathlib import Path

# Ads, trackers, malware: always on.
LISTS = {
    "easylist": "https://easylist.to/easylist/easylist.txt",
    "easyprivacy": "https://easylist.to/easylist/easyprivacy.txt",
    "ublock-ads": "https://ublockorigin.github.io/uAssets/filters/filters.txt",
    "ublock-privacy": "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
    "ublock-badware": "https://ublockorigin.github.io/uAssets/filters/badware.txt",
    "ublock-unbreak": "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
    "ublock-quick-fixes": "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
    "peter-lowe": "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext",
}

# Cookie banners, newsletter popups, chat widgets: shipped disabled, toggled in options.
ANNOYANCE_LISTS = {
    "easylist-cookies": "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
    "ublock-annoyances-cookies": "https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt",
    "ublock-annoyances-others": "https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt",
}

CACHE = Path(__file__).resolve().parent / ".cache"

# Environment we compile for (a Chromium MV3 extension).
ENV = {
    "env_chromium": True, "env_mv3": True, "env_edge": False, "env_firefox": False, "env_safari": False,
    "env_mobile": False, "env_legacy": False, "adguard": False, "adguard_app_windows": False,
    "adguard_ext_chromium": False, "ext_ublock": True, "ext_ubol": True, "cap_html_filtering": False,
    "cap_user_stylesheet": True, "cap_ipaddress": False, "false": False, "true": True,
}


def fetch(url, offline=False):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / re.sub(r"[^A-Za-z0-9._-]+", "_", url)[-150:]
    if offline and path.exists():
        return path.read_text(encoding="utf-8")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AdWall-builder"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8", "replace")
        path.write_text(text, encoding="utf-8")
        return text
    except OSError:
        if path.exists():
            print(f"  ! network failed, using cached {url}")
            return path.read_text(encoding="utf-8")
        raise


def _eval_condition(expr):
    py = expr.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    py = re.sub(r"[A-Za-z_][A-Za-z0-9_]*", lambda m: m.group(0) if m.group(0) in ("and", "or", "not") else str(ENV.get(m.group(0), False)), py)
    try:
        return bool(eval(py, {"__builtins__": {}}))
    except Exception:
        return False


def preprocess(text, base_url, offline=False, depth=0):
    """Yield filter lines with !#if blocks resolved and !#include files inlined."""
    stack = []  # each entry: is this branch active?
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("!#if "):
            stack.append(_eval_condition(line[5:]))
            continue
        if line.startswith("!#else"):
            if stack:
                stack[-1] = not stack[-1]
            continue
        if line.startswith("!#endif"):
            if stack:
                stack.pop()
            continue
        if not all(stack):
            continue
        if line.startswith("!#include ") and depth < 3:
            sub_url = urllib.parse.urljoin(base_url, line[len("!#include "):].strip())
            yield from preprocess(fetch(sub_url, offline), sub_url, offline, depth + 1)
            continue
        if line and not line.startswith(("!", "[Adblock")):
            yield line


def load_all(offline=False, sources=None):
    """Return {list_name: [lines]}."""
    out = {}
    for name, url in (sources or LISTS).items():
        print(f"fetching {name}")
        out[name] = list(preprocess(fetch(url, offline), url, offline))
    return out
