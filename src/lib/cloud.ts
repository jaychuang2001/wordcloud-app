import type { RoomConfig, TopicData } from "./wordcloud-core";

/*
 * Browser-side client for the organiser's own Google Sheet backend (an Apps
 * Script web app, see apps-script/Code.gs). Each organiser connects their own
 * sheet, so nothing here is tied to one person's spreadsheet. With no sheet
 * connected every call answers "no_store" and the app stays in its browser-only
 * mode.
 */

const URL_KEY = "wc:scriptUrl";
const PW_KEY = "wc:hostPw";

/* --------------------------- connection URL --------------------------- */

/** Accepts a full /exec URL or just the deployment id; returns a clean /exec URL or null. */
export function parseScriptUrl(input: string): string | null {
  const t = input.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(t)) return `https://script.google.com/macros/s/${t}/exec`;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return null;
    if (u.hostname !== "script.google.com" && u.hostname !== "script.googleusercontent.com") return null;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/** Short form for share links: just the deployment id when the URL is the standard kind. */
export function scriptParam(url: string): string {
  const m = /^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/.exec(url);
  return m ? m[1]! : url;
}

/**
 * The connected sheet's web-app URL. A `?s=` in the page address wins and is
 * remembered, so pasting a link on another computer connects it automatically.
 */
export function getScriptUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const p = new URLSearchParams(window.location.search).get("s");
    if (p) {
      const parsed = parseScriptUrl(p);
      if (parsed) {
        window.localStorage.setItem(URL_KEY, parsed);
        return parsed;
      }
    }
    return window.localStorage.getItem(URL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setScriptUrl(url: string) {
  try {
    if (url) window.localStorage.setItem(URL_KEY, url);
    else window.localStorage.removeItem(URL_KEY);
  } catch {
    /* ignore */
  }
}

/** Stable short id of the connected sheet, used to keep different organisers' live channels apart. */
export function tenantId(): string {
  const url = getScriptUrl();
  if (!url) return "";
  const id = scriptParam(url);
  if (id.length <= 24 && !id.includes("/")) return id.slice(0, 24);
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return `t${(h >>> 0).toString(36)}`;
}

/* ------------------------------ host password ------------------------------ */

export function getHostPassword(): string {
  try {
    return window.sessionStorage.getItem(PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setHostPassword(pw: string) {
  try {
    if (pw) window.sessionStorage.setItem(PW_KEY, pw);
    else window.sessionStorage.removeItem(PW_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------------------------- calls ---------------------------------- */

type Reply = { ok: boolean; reason?: string; [k: string]: unknown };

async function call(
  payload: Record<string, unknown>,
  timeoutMs = 25000,
  urlOverride?: string,
): Promise<Reply> {
  const url = urlOverride ?? getScriptUrl();
  if (!url) return { ok: false, reason: "no_store" };
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // A plain-text body keeps this a "simple" request (no CORS preflight), which Apps Script requires.
    const res = await fetch(url, { method: "POST", body: JSON.stringify(payload), signal: ctl.signal });
    const text = await res.text();
    return JSON.parse(text) as Reply;
  } catch {
    return { ok: false, reason: "network" };
  } finally {
    window.clearTimeout(timer);
  }
}

export type UnlockResult = "ok" | "bad_password" | "password_not_set" | "network" | "no_store";

/** Checks a password against the sheet's HOST_PASSWORD; remembered for this tab when right. */
export async function unlockHost(password: string): Promise<UnlockResult> {
  const res = await call({ action: "verify", password });
  if (res.ok) {
    setHostPassword(password);
    return "ok";
  }
  if (res.reason === "no_store") return "no_store";
  if (res.reason === "password_not_set") return "password_not_set";
  if (res.reason === "network" || res.reason === "error") return "network";
  return "bad_password";
}

/** Returns the cached host password, or asks for it (used by screen-side clear/import). */
export async function ensureHostPassword(): Promise<string | null> {
  const cached = getHostPassword();
  if (cached) return cached;
  const entered = window.prompt("這個動作需要主辦密碼，請輸入：");
  if (!entered) return null;
  return (await unlockHost(entered)) === "ok" ? entered : null;
}

/** Tests a connection URL without saving it. */
export async function testConnection(url: string): Promise<boolean> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, { method: "POST", body: JSON.stringify({ action: "ping" }), signal: ctl.signal });
    const j = (await res.json()) as Reply;
    return j.ok === true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchRemoteConfig(): Promise<
  { state: "off" } | { state: "on"; config: RoomConfig | null }
> {
  const res = await call({ action: "getConfig" });
  return res.ok ? { state: "on", config: (res.config as RoomConfig | null) ?? null } : { state: "off" };
}

/** Reads the config of a specific sheet (used while connecting, before it is saved). */
export async function fetchConfigFromUrl(
  url: string,
): Promise<{ ok: true; config: RoomConfig | null } | { ok: false }> {
  const res = await call({ action: "getConfig" }, 25000, url);
  return res.ok ? { ok: true, config: (res.config as RoomConfig | null) ?? null } : { ok: false };
}

export async function pushRemoteConfig(config: RoomConfig): Promise<"ok" | "locked" | "error"> {
  const password = getHostPassword();
  if (!password) return "locked";
  const res = await call({ action: "setConfig", password, config });
  if (res.ok) return "ok";
  if (res.reason === "bad_password") {
    setHostPassword("");
    return "locked";
  }
  return "error";
}

export async function fetchRemoteData(_room: string, topicId: string): Promise<TopicData | null> {
  const res = await call({ action: "getData", topicId });
  return res.ok ? (res.data as TopicData) : null;
}

export async function fetchRemoteSummary(
  _room: string,
  topicIds: string[],
): Promise<Record<string, number> | null> {
  const res = await call({ action: "getSummary", topicIds });
  return res.ok ? (res.counts as Record<string, number>) : null;
}

/**
 * Host-only write. `data` = null deletes the topic's worksheet; otherwise the
 * worksheet's rows are replaced (empty data = clear, merged data = CSV import).
 */
export async function replaceRemoteData(
  _room: string,
  topicId: string,
  data: TopicData | null,
): Promise<boolean> {
  const password = await ensureHostPassword();
  if (!password) return false;
  const res =
    data === null
      ? await call({ action: "deleteTopic", password, topicId })
      : await call({ action: "replaceData", password, topicId, data });
  if (!res.ok && res.reason === "bad_password") setHostPassword("");
  return res.ok;
}

export type SubmitResult =
  | { kind: "ok"; words: string[] }
  | { kind: "local" } // no sheet connected: publish directly like before
  | { kind: "blocked"; word: string }
  | { kind: "rejected"; message: string };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export async function submitToCloud(
  room: string,
  topicId: string,
  words: string[],
): Promise<SubmitResult> {
  // Google can briefly refuse requests when many people submit at once, so
  // retry a few times with a growing, slightly random pause before giving up.
  let res: Reply = { ok: false, reason: "network" };
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await call({ action: "submit", room, topicId, words, ts: Date.now() }, 30000);
    if (res.ok || (res.reason !== "network" && res.reason !== "error")) break;
    await sleep(700 * (attempt + 1) + Math.random() * 600);
  }
  if (res.ok) return { kind: "ok", words: res.words as string[] };
  switch (res.reason) {
    case "no_store":
      return { kind: "local" };
    case "blocked":
      return { kind: "blocked", word: String(res.word ?? "") };
    case "topic_disabled":
      return { kind: "rejected", message: "這個主題目前沒有開放投稿" };
    case "room_mismatch":
      return { kind: "rejected", message: "這個連結已過期，請重新掃描最新的 QR Code" };
    case "no_config":
      return { kind: "rejected", message: "主辦方尚未完成設定，請稍後再試" };
    case "empty":
      return { kind: "rejected", message: "請至少輸入一個詞彙" };
    case "network":
    case "error":
      return { kind: "rejected", message: "目前投稿的人很多，請稍等幾秒後再按一次送出" };
    default:
      return { kind: "rejected", message: "送出失敗，請再試一次" };
  }
}
