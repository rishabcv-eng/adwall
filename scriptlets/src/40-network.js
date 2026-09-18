// Scriptlets that edit JSON and network responses (this is what strips YouTube ads).

// Path syntax: "a.b.c", "[]" = every key, "[-]" = remove array elements that contain the rest.
function prunePath(obj, parts, dryRun) {
  if (obj === null || typeof obj !== "object") return false;
  const [head, ...rest] = parts;
  if (head === "[]") {
    let found = false;
    for (const key of Object.keys(obj)) found = prunePath(obj[key], rest, dryRun) || found;
    return found;
  }
  if (head === "[-]") {
    if (!Array.isArray(obj)) return false;
    let found = false;
    for (let i = obj.length - 1; i >= 0; i--) {
      if (rest.length === 0 || prunePath(obj[i], rest, true)) {
        found = true;
        if (!dryRun) obj.splice(i, 1);
      }
    }
    return found;
  }
  if (!(head in obj)) return false;
  if (rest.length === 0) {
    if (!dryRun) delete obj[head];
    return true;
  }
  return prunePath(obj[head], rest, dryRun);
}

function makePruner(rawPrunePaths = "", rawNeedlePaths = "") {
  const split = (raw) => raw.split(/\s+/).filter((p) => p && p !== "important").map((p) => p.split("."));
  const prune = split(rawPrunePaths);
  const needles = split(rawNeedlePaths);
  return (obj) => {
    if (obj === null || typeof obj !== "object" || !prune.length) return obj;
    if (needles.length && !needles.every((n) => prunePath(obj, n, true))) return obj;
    for (const p of prune) prunePath(obj, p, false);
    return obj;
  };
}

function extraArgs(extra) {
  const map = {};
  for (let i = 0; i + 1 < extra.length; i += 2) map[extra[i]] = extra[i + 1];
  return map;
}

function rebuildResponse(original, body) {
  const r = new Response(body, { status: original.status, statusText: original.statusText, headers: original.headers });
  for (const key of ["url", "type", "redirected"]) {
    try { natives.defineProperty(r, key, { value: original[key] }); } catch {}
  }
  return r;
}

// Wrap fetch so matching responses get their text transformed.
function hookFetchResponse(props, transformText) {
  const real = self.fetch;
  self.fetch = disguise(function (resource, init) {
    const promise = real.apply(this, arguments);
    if (!propsMatch(props, requestDetails(resource, init))) return promise;
    return promise.then((resp) =>
      resp.clone().text().then((text) => {
        const out = transformText(text);
        return out === text ? resp : rebuildResponse(resp, out);
      }).catch(() => resp)
    );
  }, real);
}

// --- XHR hooking (installed once, shared by all XHR scriptlets) ---------------
const xhrInfo = new WeakMap();
const xhrTransforms = [];
const xhrBlocks = [];
let xhrInstalled = false;

function installXhr() {
  if (xhrInstalled) return;
  xhrInstalled = true;
  const proto = XMLHttpRequest.prototype;
  const open = proto.open;
  const send = proto.send;

  proto.open = disguise(function (method, url, ...rest) {
    xhrInfo.set(this, { details: { method: String(method), url: String(url) } });
    return open.call(this, method, url, ...rest);
  }, open);

  proto.send = disguise(function (body) {
    const info = xhrInfo.get(this);
    if (info) {
      const block = xhrBlocks.find((b) => propsMatch(b.props, info.details));
      if (block) {
        fakeXhr(this, info, block.body);
        return undefined;
      }
      info.transforms = xhrTransforms.filter((t) => propsMatch(t.props, info.details));
    }
    return send.call(this, body);
  }, send);

  for (const prop of ["response", "responseText"]) {
    const desc = natives.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.get) continue;
    natives.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const info = xhrInfo.get(this);
        if (info?.fake !== undefined) return info.fake;
        const value = desc.get.call(this);
        if (!info?.transforms?.length || this.readyState !== 4) return value;
        if (info.cached === undefined) {
          let text = null;
          if (this.responseType === "" || this.responseType === "text") text = desc.get.call(this);
          else if (this.responseType === "json") text = natives.JSONstringify(value);
          if (text === null) return value;
          for (const t of info.transforms) text = t.transform(text);
          info.cached = text;
        }
        return this.responseType === "json" ? natives.JSONparse(info.cached) : info.cached;
      },
    });
  }
}

function fakeXhr(xhr, info, body) {
  info.fake = body;
  const define = (k, v) => { try { natives.defineProperty(xhr, k, { value: v, configurable: true }); } catch {} };
  define("readyState", 4);
  define("status", 200);
  define("statusText", "OK");
  define("responseURL", info.details.url);
  natives.setTimeout.call(self, () => {
    for (const type of ["readystatechange", "load", "loadend"]) xhr.dispatchEvent(new Event(type));
  }, 1);
}

function textPruner(pruner) {
  return (text) => {
    let obj;
    try { obj = natives.JSONparse(text); } catch { return text; }
    const before = natives.JSONstringify(obj);
    const after = natives.JSONstringify(pruner(obj));
    return after === before ? text : after;
  };
}

function fakeBody(raw) {
  if (raw === "emptyObj" || raw === "{}") return "{}";
  if (raw === "emptyArr" || raw === "[]") return "[]";
  return "";
}

// json-prune: prune objects produced by JSON.parse and Response.json().
SCRIPTLETS["json-prune"] = (rawPrunePaths, rawNeedlePaths) => {
  const pruner = makePruner(rawPrunePaths, rawNeedlePaths);
  const realParse = JSON.parse;
  JSON.parse = disguise(function () {
    return pruner(realParse.apply(this, arguments));
  }, realParse);
  const realJson = Response.prototype.json;
  Response.prototype.json = disguise(function () {
    return realJson.apply(this, arguments).then(pruner);
  }, realJson);
};

SCRIPTLETS["json-prune-fetch-response"] = (rawPrunePaths, rawNeedlePaths, ...extra) => {
  const props = parsePropsToMatch(extraArgs(extra).propsToMatch);
  hookFetchResponse(props, textPruner(makePruner(rawPrunePaths, rawNeedlePaths)));
};

SCRIPTLETS["json-prune-xhr-response"] = (rawPrunePaths, rawNeedlePaths, ...extra) => {
  installXhr();
  const props = parsePropsToMatch(extraArgs(extra).propsToMatch);
  xhrTransforms.push({ props, transform: textPruner(makePruner(rawPrunePaths, rawNeedlePaths)) });
};

SCRIPTLETS["trusted-replace-fetch-response"] = (pattern = "", replacement = "", propsToMatch = "") => {
  if (!pattern) return;
  const re = patternToRegex(pattern, "g");
  hookFetchResponse(parsePropsToMatch(propsToMatch), (text) => text.replace(re, replacement));
};

SCRIPTLETS["trusted-replace-xhr-response"] = (pattern = "", replacement = "", propsToMatch = "") => {
  if (!pattern) return;
  installXhr();
  const re = patternToRegex(pattern, "g");
  xhrTransforms.push({ props: parsePropsToMatch(propsToMatch), transform: (text) => text.replace(re, replacement) });
};

// no-fetch-if / prevent-fetch: answer matching requests with an empty response.
SCRIPTLETS["no-fetch-if"] = (propsToMatch = "", responseBody = "") => {
  if (!propsToMatch) return;
  const props = parsePropsToMatch(propsToMatch);
  const real = self.fetch;
  self.fetch = disguise(function (resource, init) {
    const details = requestDetails(resource, init);
    if (!propsMatch(props, details)) return real.apply(this, arguments);
    const resp = new Response(fakeBody(responseBody), { status: 200, statusText: "OK" });
    try { natives.defineProperty(resp, "url", { value: details.url }); } catch {}
    return Promise.resolve(resp);
  }, real);
};

// no-xhr-if / prevent-xhr
SCRIPTLETS["no-xhr-if"] = (propsToMatch = "", directive = "") => {
  if (!propsToMatch) return;
  installXhr();
  xhrBlocks.push({ props: parsePropsToMatch(propsToMatch), body: fakeBody(directive) });
};
