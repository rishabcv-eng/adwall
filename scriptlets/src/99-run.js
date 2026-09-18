// Each generated data file pushes [scriptletName, argsByHost, excludedHosts]
// onto the queue just before this runtime executes.

function hostAncestors(hostname) {
  const out = [];
  const labels = hostname.split(".");
  for (let i = 0; i < labels.length; i++) out.push(labels.slice(i).join("."));
  return out;
}

const queue = self.__adwallQueue;
try { delete self.__adwallQueue; } catch {}

if (Array.isArray(queue)) {
  const ancestors = hostAncestors(location.hostname);
  for (const [name, argsByHost, excluded] of queue) {
    const scriptlet = SCRIPTLETS[name];
    if (!scriptlet || ancestors.some((h) => excluded[h])) continue;
    const seen = new Set();
    for (const host of ancestors) {
      for (const args of argsByHost[host] || []) {
        const key = natives.JSONstringify(args);
        if (seen.has(key)) continue;
        seen.add(key);
        try { scriptlet(...args); } catch {}
      }
    }
  }
}
