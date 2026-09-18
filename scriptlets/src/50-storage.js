// Scriptlets that set or remove cookies and web storage (e.g. "ad blocker notice dismissed").

const SAFE_STORAGE_VALUES = /^(undefined|null|false|true|yes|no|on|off|accept|accepted|reject|rejected|allow|allowed|deny|denied|ok|\{\}|\[\]|""|''|-?\d+|\$remove\$|emptyObj|emptyArr|emptyStr)$/;

function storageValue(raw) {
  if (raw === "emptyObj") return "{}";
  if (raw === "emptyArr") return "[]";
  if (raw === "emptyStr" || raw === '""' || raw === "''") return "";
  return raw;
}

function setStorageItem(storageName, key, raw, trusted) {
  if (!key || (!trusted && !SAFE_STORAGE_VALUES.test(raw))) return;
  try {
    const storage = self[storageName];
    if (raw === "$remove$") {
      const matches = needleMatcher(key);
      for (const k of Object.keys(storage)) if (k === key || (key.startsWith("/") && matches(k))) storage.removeItem(k);
    } else {
      storage.setItem(key, storageValue(raw));
    }
  } catch {}
}

SCRIPTLETS["set-local-storage-item"] = (key, value) => setStorageItem("localStorage", key, value, false);
SCRIPTLETS["set-session-storage-item"] = (key, value) => setStorageItem("sessionStorage", key, value, false);
SCRIPTLETS["trusted-set-local-storage-item"] = (key, value) => setStorageItem("localStorage", key, value, true);

function writeCookie(name, value, path) {
  const cookiePath = path === "none" ? "" : `; path=${path === "" || path === undefined ? "/" : path}`;
  try { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}${cookiePath}`; } catch {}
}

SCRIPTLETS["set-cookie"] = (name, value = "", path) => {
  if (!name || !SAFE_STORAGE_VALUES.test(value)) return;
  writeCookie(name, storageValue(value), path);
};

SCRIPTLETS["trusted-set-cookie"] = (name, value = "", _offset, _reload, path) => {
  if (!name) return;
  writeCookie(name, value.replace("$now$", String(Date.now())), path);
};

// remove-cookie / cookie-remover
SCRIPTLETS["remove-cookie"] = (needle = "") => {
  const matches = needleMatcher(needle);
  const remove = () => {
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0].trim();
      if (!name || !matches(name)) continue;
      const expire = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      const domains = ["", location.hostname, "." + location.hostname.split(".").slice(-2).join(".")];
      for (const d of domains) {
        document.cookie = `${expire}; path=/${d ? `; domain=${d}` : ""}`;
      }
    }
  };
  remove();
  self.addEventListener("beforeunload", remove);
  document.addEventListener("visibilitychange", remove);
};
