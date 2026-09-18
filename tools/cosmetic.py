"""Parse cosmetic (##), procedural and scriptlet (##+js) filters into per-host data."""
import re
from collections import defaultdict

from network import normalize_domain

SUPPORTED_SCRIPTLETS = {
    "set", "trusted-set", "aopr", "aopw", "acs", "aost", "nofab", "popads-dummy",
    "nostif", "nosiif", "nano-stb", "nano-sib", "noeval-if", "noeval", "aeld", "nowoif", "nowebrtc", "refresh-defuser",
    "rmnt", "rpnt", "ra", "rc", "href-sanitizer",
    "json-prune", "json-prune-fetch-response", "json-prune-xhr-response",
    "trusted-replace-fetch-response", "trusted-replace-xhr-response", "no-fetch-if", "no-xhr-if",
    "set-local-storage-item", "set-session-storage-item", "trusted-set-local-storage-item",
    "set-cookie", "trusted-set-cookie", "remove-cookie",
}
ALIASES = {
    "set-constant": "set", "trusted-set-constant": "trusted-set",
    "abort-on-property-read": "aopr", "abort-on-property-write": "aopw",
    "abort-current-script": "acs", "abort-current-inline-script": "acs", "acis": "acs",
    "abort-on-stack-trace": "aost", "fuckadblock.js-3.2.0": "nofab",
    "no-setTimeout-if": "nostif", "prevent-setTimeout": "nostif", "setTimeout-defuser": "nostif",
    "no-setInterval-if": "nosiif", "prevent-setInterval": "nosiif", "setInterval-defuser": "nosiif",
    "nano-setTimeout-booster": "nano-stb", "adjust-setTimeout": "nano-stb",
    "nano-setInterval-booster": "nano-sib", "adjust-setInterval": "nano-sib",
    "prevent-eval-if": "noeval-if", "noeval-if": "noeval-if", "silent-noeval": "noeval",
    "addEventListener-defuser": "aeld", "prevent-addEventListener": "aeld",
    "window.open-defuser": "nowoif", "no-window-open-if": "nowoif", "prevent-window-open": "nowoif",
    "nowebrtc": "nowebrtc", "remove-node-text": "rmnt", "replace-node-text": "rpnt",
    "trusted-rpnt": "rpnt", "trusted-replace-node-text": "rpnt",
    "remove-attr": "ra", "remove-class": "rc", "prevent-fetch": "no-fetch-if", "prevent-xhr": "no-xhr-if",
    "cookie-remover": "remove-cookie", "urlskip": None,
}
TRUSTED_ONLY = {"trusted-set", "trusted-replace-fetch-response", "trusted-replace-xhr-response",
                "trusted-set-local-storage-item", "trusted-set-cookie"}
# Original names starting with trusted- that map to an untrusted implementation still need a trusted list.
PROCEDURAL_OPS = ("has-text", "upward", "remove", "remove-attr", "remove-class", "min-text-length", "matches-css")
UNSUPPORTED_SELECTOR = re.compile(
    r":(-abp-[a-z-]+|xpath|matches-css-before|matches-css-after|matches-path|matches-attr|matches-media|"
    r"matches-prop|watch-attr|others|shadow|if|if-not|nth-ancestor|contains|properties)\("
)


def parse_hosts(raw):
    """'a.com,~b.com' -> (includes, excludes). Entities (x.*) and regex hosts are dropped."""
    inc, exc = [], []
    for part in raw.split(","):
        part = part.strip().replace(">>", "")
        if not part:
            continue
        neg = part.startswith("~")
        d = normalize_domain(part[1:] if neg else part)
        if d:
            (exc if neg else inc).append(d)
    return inc, exc


def balanced(sel):
    depth_paren = depth_brack = 0
    quote = None
    for ch in sel:
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "(":
            depth_paren += 1
        elif ch == ")":
            depth_paren -= 1
        elif ch == "[":
            depth_brack += 1
        elif ch == "]":
            depth_brack -= 1
        if depth_paren < 0 or depth_brack < 0:
            return False
    return depth_paren == 0 and depth_brack == 0 and quote is None


def split_top_level_ops(sel):
    """Split 'div.x:has-text(foo):upward(2)' into ('div.x', [('has-text','foo'), ('upward','2')]).
    Returns None when a procedural op is nested inside another pseudo-class."""
    ops = []
    base_end = None
    i, depth = 0, 0
    while i < len(sel):
        ch = sel[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == ":" and depth == 0:
            m = re.match(r":(" + "|".join(PROCEDURAL_OPS) + r")\(", sel[i:])
            if m:
                if base_end is None:
                    base_end = i
                j = i + len(m.group(0))
                d, start = 1, j
                while j < len(sel) and d:
                    d += {"(": 1, ")": -1}.get(sel[j], 0)
                    j += 1
                if d:
                    return None
                ops.append((m.group(1), sel[start:j - 1]))
                i = j
                continue
            if ops:
                return None  # plain CSS after a procedural op: not supported
        i += 1
    if not ops:
        return sel, []
    base = sel[:base_end].strip()
    for name, arg in ops:
        if any(f":{op}(" in arg for op in PROCEDURAL_OPS):
            return None
    if any(f":{op}(" in base for op in PROCEDURAL_OPS):
        return None
    return base, ops


def split_args(raw):
    args, cur, i = [], "", 0
    while i < len(raw):
        ch = raw[i]
        if ch == "\\" and i + 1 < len(raw) and raw[i + 1] == ",":
            cur += ","
            i += 2
            continue
        if ch == ",":
            args.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    args.append(cur)
    out = []
    for a in args:
        a = a.strip()
        if len(a) >= 2 and a[0] == a[-1] and a[0] in "'\"`":
            a = a[1:-1]
        out.append(a)
    return out


class CosmeticCompiler:
    def __init__(self):
        self.generic = set()
        self.generic_exceptions = defaultdict(set)   # host -> selectors not to hide generically
        self.specific = defaultdict(set)             # host -> css rule text
        self.specific_exceptions = defaultdict(set)  # host -> selectors
        self.procedural = defaultdict(set)           # host -> json-able procedural specs
        self.scriptlets = defaultdict(lambda: defaultdict(list))  # name -> host -> [args]
        self.scriptlet_excluded = defaultdict(dict)  # name -> {host: 1}
        self.scriptlet_exceptions = []               # (host, name or None, args or None)
        self.stats = defaultdict(int)

    def add(self, line, trusted):
        m = re.match(r"^([^#]*)#(@?)#(.*)$", line)
        if not m or line.startswith("##^") or "#?#" in line or "#$#" in line or "#%#" in line:
            return
        hosts_raw, exception, body = m.group(1), m.group(2) == "@", m.group(3)
        if body.startswith("^"):
            return  # HTML filtering: needs response body access
        if "*" == hosts_raw.strip() or re.search(r"(^|,)\*($|,)", hosts_raw):
            hosts_raw = ",".join(h for h in hosts_raw.split(",") if h.strip() != "*")
            if not hosts_raw:
                return
        inc, exc = parse_hosts(hosts_raw) if hosts_raw else ([], [])
        if hosts_raw and not inc and not exc:
            self.stats["skipped-entity-hosts"] += 1
            return

        if body.startswith("+js(") and body.endswith(")"):
            self.add_scriptlet(inc, exc, exception, body[4:-1], trusted)
            return

        sel = body.strip()
        if not sel or "{" in sel or "}" in sel or not balanced(sel) or UNSUPPORTED_SELECTOR.search(sel):
            self.stats["skipped-selector"] += 1
            return

        if exception:
            targets = inc or [""]
            for h in targets:
                if h:
                    self.generic_exceptions[h].add(sel)
                    self.specific_exceptions[h].add(sel)
                else:
                    self.generic.discard(sel)
            return

        style = None
        sm = re.search(r":style\((.*)\)$", sel)
        if sm:
            style = sm.group(1).strip()
            sel = sel[:sm.start()]
            if not inc or re.search(r"url\(|expression|@import|\\", style):
                return

        if not style:
            split = split_top_level_ops(sel)
            if split is None:
                self.stats["skipped-procedural"] += 1
                return
            base, ops = split
            if ops:
                if not inc:
                    return
                for h in inc:
                    self.procedural[h].add((base, tuple(ops)))
                self.stats["procedural"] += 1
                return

        if not inc:
            self.generic.add(sel)
            for h in exc:
                self.generic_exceptions[h].add(sel)
            return

        decl = "display:none!important" if style is None else ";".join(
            f"{d.strip()}!important" if "!important" not in d else d.strip() for d in style.split(";") if d.strip()
        )
        for h in inc:
            self.specific[h].add(f"{sel}{{{decl}}}")
        for h in exc:
            self.specific_exceptions[h].add(sel)

    def add_scriptlet(self, inc, exc, exception, raw, trusted):
        args = split_args(raw) if raw.strip() else []
        if exception:
            name = None if not args else self.normalize_name(args[0])
            for h in inc or [""]:
                self.scriptlet_exceptions.append((h, name, tuple(args[1:]) if args else None))
            return
        if not args or not inc:
            return
        original = args[0].strip()
        name = self.normalize_name(original)
        if name not in SUPPORTED_SCRIPTLETS:
            self.stats[f"unsupported-scriptlet:{original}"] += 1
            return
        if (name in TRUSTED_ONLY or original.startswith("trusted-")) and not trusted:
            return
        for h in inc:
            self.scriptlets[name][h].append(args[1:])
        for h in exc:
            self.scriptlet_excluded[name][h] = 1

    @staticmethod
    def normalize_name(name):
        name = name.strip()
        if name.endswith(".js"):
            name = name[:-3]
        return ALIASES.get(name, name) or ""

    def finalize(self):
        for host, name, args in self.scriptlet_exceptions:
            if not host:
                continue
            names = [name] if name else list(self.scriptlets)
            for n in names:
                if n not in self.scriptlets or host not in self.scriptlets[n]:
                    if name and not args:
                        self.scriptlet_excluded[name][host] = 1
                    continue
                if args:
                    self.scriptlets[n][host] = [a for a in self.scriptlets[n][host] if tuple(a) != args]
                else:
                    del self.scriptlets[n][host]
                    self.scriptlet_excluded[n][host] = 1
        for host, sels in self.specific_exceptions.items():
            if host in self.specific:
                self.specific[host] = {r for r in self.specific[host] if r.split("{", 1)[0] not in sels}
        self.generic_exceptions = {h: s & self.generic for h, s in self.generic_exceptions.items() if s & self.generic}
