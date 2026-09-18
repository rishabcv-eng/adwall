"""Convert Adblock Plus / uBlock Origin network filters to Chrome declarativeNetRequest rules."""
import json
import re
from collections import defaultdict

TYPE_MAP = {
    "script": "script", "image": "image", "img": "image", "stylesheet": "stylesheet", "css": "stylesheet",
    "subdocument": "sub_frame", "frame": "sub_frame", "xmlhttprequest": "xmlhttprequest", "xhr": "xmlhttprequest",
    "media": "media", "font": "font", "object": "object", "ping": "ping", "beacon": "ping",
    "websocket": "websocket", "other": "other", "popup": "main_frame", "document": "main_frame", "doc": "main_frame",
}
ALL_TYPES = ["main_frame", "sub_frame", "script", "image", "stylesheet", "xmlhttprequest",
             "media", "font", "object", "ping", "websocket", "other"]
HARMLESS_TO_BLOCK = {"image", "media", "ping", "other", "font"}
METHODS = {"connect", "delete", "get", "head", "options", "patch", "post", "put"}

# Options we can't express in DNR: drop the whole filter rather than over-block.
UNSUPPORTED = {"csp", "removeparam", "urlskip", "replace", "uritransform", "urltransform", "permissions", "cname",
               "header", "ipaddress", "popunder", "inline-script", "inline-font", "top", "rewrite", "specifichide",
               "shide", "requestheader", "responseheader", "empty", "mp4", "webrtc", "genericblock", "content", "elemhide-rule"}
IGNORED = {"reason", "_"}

# Filter-list redirect names -> files shipped in resources/.
REDIRECTS = {
    "noopjs": "noop.js", "noop.js": "noop.js", "abp-resource:blank-js": "noop.js",
    "nooptext": "noop.txt", "noop.txt": "noop.txt", "empty": "noop.txt",
    "noopframe": "noop.html", "noop.html": "noop.html", "noopcss": "noop.css", "noop.css": "noop.css",
    "noopjson": "noop.json", "noop.json": "noop.json",
    "1x1.gif": "1x1.gif", "1x1-transparent.gif": "1x1.gif", "2x2.png": "2x2.png", "2x2-transparent.png": "2x2.png",
    "3x2.png": "3x2.png", "3x2-transparent.png": "3x2.png", "32x32.png": "32x32.png", "32x32-transparent.png": "32x32.png",
    "googletagmanager_gtm.js": "googletagmanager_gtm.js", "googletagmanager.com/gtm.js": "googletagmanager_gtm.js",
    "google-analytics_analytics.js": "google-analytics_analytics.js", "google-analytics.com/analytics.js": "google-analytics_analytics.js",
    "google-analytics_ga.js": "google-analytics_ga.js", "google-analytics.com/ga.js": "google-analytics_ga.js",
    "googlesyndication_adsbygoogle.js": "googlesyndication_adsbygoogle.js", "googlesyndication.com/adsbygoogle.js": "googlesyndication_adsbygoogle.js",
    "googletagservices_gpt.js": "googletagservices_gpt.js", "googletagservices.com/gpt.js": "googletagservices_gpt.js",
    "amazon_apstag.js": "amazon_apstag.js", "amazon-adsystem.com/aax2/apstag.js": "amazon_apstag.js",
    "fingerprint2.js": "fingerprint2.js", "prebid-ads.js": "prebid-ads.js",
    "fuckadblock.js-3.2.0": "fuckadblock.js", "nofab.js": "fuckadblock.js",
    "chartbeat.js": "chartbeat.js", "google-ima.js": "google-ima.js", "google-ima3": "google-ima.js",
    "noopvast-2.0": "noop-vast.xml", "noopvast-3.0": "noop-vast.xml", "noopvast-4.0": "noop-vast.xml",
    "noopvmap-1.0": "noop-vmap.xml",
}

PRIORITY = {"block": 1, "redirect": 2, "allow": 3, "allowAllRequests": 3}
IMPORTANT_BUMP = 3  # important block/redirect (4/5) beats list exceptions (3); user allowlist is 100

DOMAIN_OK = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")
GROUPABLE = re.compile(r"^\|\|([a-z0-9][a-z0-9.-]*\.[a-z0-9-]{2,})\^$")


def normalize_domain(d):
    d = d.strip().lower().rstrip(".")
    if not d or "*" in d or d.startswith("/"):
        return None
    try:
        d = d.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    return d if DOMAIN_OK.match(d) else None


def split_domains(value):
    """'a.com|~b.com|c.*' -> (included, excluded, had_unusable_includes)."""
    inc, exc, dropped = [], [], False
    for part in value.split("|"):
        neg = part.startswith("~")
        d = normalize_domain(part[1:] if neg else part)
        if d is None:
            dropped = dropped or not neg
            continue
        (exc if neg else inc).append(d)
    return inc, exc, dropped


def split_filter(line):
    """Return (pattern, options list) or None."""
    if line.startswith("/") and re.match(r"^/.*/(\$[^/]*)?$", line):
        return None  # regex filter: skipped
    idx = line.rfind("$")
    if idx == -1 or (idx > 0 and line[idx - 1] == "\\"):
        return line, []
    opts = line[idx + 1:]
    if not opts or not re.match(r"^~?[a-z0-9_-]+(=|,|$)", opts):
        return line, []
    return line[:idx], [o.strip() for o in opts.split(",") if o.strip()]


class NetworkCompiler:
    def __init__(self):
        self.badfilters = set()
        self.groups = defaultdict(set)
        self.rules = {}
        self.generichide_hosts = set()
        self.stats = defaultdict(int)

    def collect_badfilters(self, lines):
        for line in lines:
            if "badfilter" not in line or "##" in line or "#@#" in line:
                continue
            parsed = split_filter(line[2:] if line.startswith("@@") else line)
            if not parsed:
                continue
            pattern, opts = parsed
            rest = sorted(o for o in opts if o != "badfilter")
            prefix = "@@" if line.startswith("@@") else ""
            self.badfilters.add((prefix + pattern, tuple(rest)))

    def add(self, line):
        if "##" in line or "#@#" in line or "#?#" in line or "#$#" in line or "#%#" in line or "$$" in line:
            return
        exception = line.startswith("@@")
        parsed = split_filter(line[2:] if exception else line)
        if not parsed:
            self.stats["skipped-regex"] += 1
            return
        pattern, opts = parsed
        if "badfilter" in opts:
            return
        if (("@@" if exception else "") + pattern, tuple(sorted(opts))) in self.badfilters:
            self.stats["badfiltered"] += 1
            return
        rule = self.convert(pattern, opts, exception)
        if rule is None:
            self.stats["skipped"] += 1
            return
        self.stats["converted"] += 1

    def convert(self, pattern, opts, exception):
        cond = {}
        types, excluded_types = set(), set()
        important = match_case = False
        redirect = None
        doc_exception = False
        cosmetic_only = False

        for opt in opts:
            name, _, value = opt.partition("=")
            neg = name.startswith("~")
            key = name[1:] if neg else name
            if key in IGNORED or re.fullmatch(r"_+", key):
                continue
            if key in UNSUPPORTED:
                return None
            if key in ("third-party", "3p", "strict3p"):
                cond["domainType"] = "firstParty" if neg else "thirdParty"
            elif key in ("first-party", "1p", "strict1p"):
                cond["domainType"] = "thirdParty" if neg else "firstParty"
            elif key == "all" and not neg:
                types.update(ALL_TYPES)
            elif key in TYPE_MAP:
                if key in ("document", "doc") and exception and not neg:
                    doc_exception = True
                (excluded_types if neg else types).add(TYPE_MAP[key])
            elif key in ("domain", "from") and value:
                inc, exc, dropped = split_domains(value)
                if dropped and not inc:
                    return None
                if inc:
                    cond["initiatorDomains"] = inc
                if exc:
                    cond["excludedInitiatorDomains"] = exc
            elif key == "to" and value:
                inc, exc, dropped = split_domains(value)
                if dropped and not inc:
                    return None
                if inc:
                    cond["requestDomains"] = inc
                if exc:
                    cond["excludedRequestDomains"] = exc
            elif key == "denyallow" and value:
                inc, _, _ = split_domains(value)
                cond["excludedRequestDomains"] = cond.get("excludedRequestDomains", []) + inc
            elif key == "method" and value:
                inc = [m.lstrip("~").lower() for m in value.split("|") if not m.startswith("~")]
                exc = [m.lstrip("~").lower() for m in value.split("|") if m.startswith("~")]
                if not set(inc + exc) <= METHODS:
                    return None
                if inc:
                    cond["requestMethods"] = inc
                if exc:
                    cond["excludedRequestMethods"] = exc
            elif key == "important":
                important = True
            elif key == "match-case":
                match_case = True
            elif key in ("generichide", "ghide", "elemhide", "ehide"):
                if not exception:
                    return None
                cosmetic_only = True
            elif key in ("redirect", "redirect-rule"):
                redirect = (key, value.split(":")[0])
            else:
                self.stats[f"unknown-option:{key}"] += 1
                return None

        if cosmetic_only:
            host = re.match(r"^\|\|([^/^*|]+)", pattern)
            if host and normalize_domain(host.group(1)):
                self.generichide_hosts.add(normalize_domain(host.group(1)))
                return True
            return None

        # --- action -----------------------------------------------------------
        if exception:
            if redirect:
                return None
            if doc_exception:
                action = {"type": "allowAllRequests"}
                types = {"main_frame", "sub_frame"}
                excluded_types = set()
            else:
                action = {"type": "allow"}
        elif redirect:
            kind, name = redirect
            if name in ("", "none"):
                return None
            if kind == "redirect-rule" and not pattern.startswith("||"):
                return None
            target = REDIRECTS.get(name)
            if target and "main_frame" not in types:
                action = {"type": "redirect", "redirect": {"extensionPath": f"/resources/{target}"}}
            elif types and types <= HARMLESS_TO_BLOCK:
                action = {"type": "block"}
            else:
                self.stats[f"unmapped-redirect:{name}"] += 1
                return None
        else:
            action = {"type": "block"}

        priority = PRIORITY[action["type"]] + (IMPORTANT_BUMP if important and action["type"] in ("block", "redirect") else 0)

        if types and excluded_types:
            types -= excluded_types
            excluded_types = set()
        if types:
            if action["type"] == "redirect" and "main_frame" in types:
                return None
            cond["resourceTypes"] = sorted(types)
        elif excluded_types:
            cond["excludedResourceTypes"] = sorted(excluded_types)

        # --- pattern ----------------------------------------------------------
        pattern = pattern.strip()
        if pattern in ("", "*", "|", "||"):
            if not (cond.get("initiatorDomains") or cond.get("requestDomains")):
                return None
            pattern = ""
        if not pattern.isascii() or " " in pattern:
            return None
        if pattern.startswith("||*"):
            pattern = pattern[2:]
        if pattern and not cond.get("initiatorDomains") and not cond.get("requestDomains"):
            core = pattern.strip("|*^")
            if len(core) < 4:
                return None

        m = GROUPABLE.match(pattern)
        simple = m and normalize_domain(m.group(1)) and set(cond) <= {"domainType", "resourceTypes", "excludedResourceTypes"}
        if simple and not match_case:
            key = json.dumps([action, priority, cond], sort_keys=True)
            self.groups[key].add(normalize_domain(m.group(1)))
            return True

        if pattern:
            cond["urlFilter"] = pattern
        if match_case:
            cond["isUrlFilterCaseSensitive"] = True
        rule = {"priority": priority, "action": action, "condition": cond}
        self.rules[json.dumps(rule, sort_keys=True)] = rule
        return True

    def emit(self, chunk=1000):
        out = []
        for key, domains in self.groups.items():
            action, priority, cond = json.loads(key)
            domains = sorted(domains)
            for i in range(0, len(domains), chunk):
                out.append({"priority": priority, "action": action,
                            "condition": {**cond, "requestDomains": domains[i:i + chunk]}})
        out.extend(self.rules.values())
        for i, rule in enumerate(out, 1):
            rule["id"] = i
        return out
