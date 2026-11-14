import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { QrPanel } from "@/components/QrPanel";
import { PREFER_LOCAL_FLAG, useWordCloudConfig } from "@/hooks/use-wordcloud-config";
import appsScriptCode from "../../apps-script/Code.gs?raw";
import {
  fetchConfigFromUrl,
  fetchRemoteData,
  fetchRemoteSummary,
  getScriptUrl,
  parseScriptUrl,
  replaceRemoteData,
  scriptParam,
  setScriptUrl,
  tenantId,
  testConnection,
} from "@/lib/cloud";
import { LOCAL_KEY_STORAGE, resetAblyClient, useAbly } from "@/lib/ably-client";
import {
  BOARD_SUGGESTED_LENGTH,
  DEFAULT_CONFIG,
  DEFAULT_TOPIC_MAX_LENGTH,
  isTopicEnabled,
  controlChannelName,
  joinUrl,
  joinUrlCloud,
  loadTopicData,
  mergeTopicData,
  MAX_TOPICS,
  MIN_TOPICS,
  nextTopicId,
  removeTopicData,
  saveExtraBlocklist,
  topicDefaultMode,
  topicHasData,
  topicSuggestedLength,
  type TopicConfig,
  type TopicData,
  type TopicMode,
} from "@/lib/wordcloud-core";
import { downloadXlsx } from "@/lib/xlsx-io";

const MODE_LABELS: Record<TopicMode, string> = {
  cloud: "文字雲",
  shape: "形狀（愛心／星星／雲朵／天燈）",
  board: "留言板",
};

type LocalTopicData = { id: string; name: string; keys: string[]; data: TopicData };

/** Finds submissions stored only in this browser (from single-machine use), per topic. */
function scanLocalData(topics: TopicConfig[]): LocalTopicData[] {
  const out: LocalTopicData[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("wc:data:")) keys.push(k);
    }
    for (const t of topics) {
      const mine = keys.filter((k) => k.endsWith(`:${t.id}`));
      let data: TopicData = { counts: {}, records: [] };
      for (const k of mine) {
        try {
          const d = JSON.parse(window.localStorage.getItem(k) ?? "null") as TopicData | null;
          if (d && d.counts) data = mergeTopicData(data, { counts: d.counts, records: d.records ?? [] });
        } catch {
          /* skip unreadable */
        }
      }
      if (Object.keys(data.counts).length > 0 || data.records.length > 0) {
        out.push({ id: t.id, name: t.name, keys: mine, data });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "主辦方控制台｜點亮「心」光" },
      {
        name: "description",
        content: "設定房間、主題名稱（數量可自行增減）與敏感詞過濾，產生觀眾掃碼 QR Code，並開啟對應的大螢幕文字雲。",
      },
      { property: "og:title", content: "主辦方控制台｜點亮「心」光" },
      { property: "og:description", content: "建立房間、產生 QR Code、開啟對應數量的大螢幕文字雲。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HostRoute,
});

function HostRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <HostPage />
    </ClientOnly>
  );
}

function HostPage() {
  const { status, error, client } = useAbly();
  const clientRef = useRef(client);
  clientRef.current = client;
  const { config, update, ready, cloud, link, sync, unlocked, unlock, lock } = useWordCloudConfig({
    // Tell open big screens to re-read the shared config right away.
    onSaved: () => {
      void clientRef.current?.channels.get(controlChannelName(tenantId())).publish("config", { ts: Date.now() });
    },
  });
  const [origin, setOrigin] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extraWords, setExtraWords] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [keyPasswordError, setKeyPasswordError] = useState("");
  const [scriptUrl, setScriptUrlState] = useState("");
  const [scriptInput, setScriptInput] = useState("");
  const [connNote, setConnNote] = useState("");
  const [connBusy, setConnBusy] = useState(false);
  const [localItems, setLocalItems] = useState<LocalTopicData[]>([]);
  const [uploadNote, setUploadNote] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  // Which way of working the host picked: one computer ("local") or several ("sync").
  const [choice, setChoice] = useState<"local" | "sync" | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
    const saved = getScriptUrl();
    setScriptUrlState(saved);
    setScriptInput(saved);
    // The mode is chosen anew each visit; only a reload we triggered ourselves (connect / disconnect) carries it over.
    try {
      const carried = window.sessionStorage.getItem("wc:nextChoice");
      window.sessionStorage.removeItem("wc:nextChoice");
      if (carried === "sync" || carried === "local") setChoice(carried);
    } catch {
      /* ignore */
    }
    setApiKey(window.localStorage.getItem(LOCAL_KEY_STORAGE) ?? "");
  }, []);

  // Extra blocked words come from the (shared) config.
  useEffect(() => {
    if (!ready) return;
    const local = window.localStorage.getItem("wc:blocklist");
    const fromConfig = config.extraBlocklist ?? [];
    const list = fromConfig.length > 0 ? fromConfig : local ? (JSON.parse(local) as string[]) : [];
    setExtraWords(list.join("、"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const refresh = async () => {
      if (cloud === "on") {
        const remote = await fetchRemoteSummary(
          config.room,
          config.topics.map((t) => t.id),
        );
        if (!cancelled && remote) setCounts(remote);
        return;
      }
      const next: Record<string, number> = {};
      for (const t of config.topics) {
        next[t.id] = Object.keys(loadTopicData(config.room, t.id).counts).length;
      }
      if (!cancelled) setCounts(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), cloud === "on" ? 10000 : 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config.room, config.topics, ready, cloud]);

  useEffect(() => {
    if (!ready || !scriptUrl) {
      setLocalItems([]);
      return;
    }
    setLocalItems(scanLocalData(config.topics));
  }, [ready, scriptUrl, config.topics]);

  // Single-machine mode has no sheet to check a password against, so the Ably key box is open there.
  const keyAccess = unlocked || link === "local";
  const sp = scriptUrl ? scriptParam(scriptUrl) : "";
  const generalUrl = useMemo(
    () =>
      !origin
        ? ""
        : sp
          ? joinUrlCloud(origin, sp)
          : joinUrl(origin, config.room, config.topics),
    [origin, sp, config.room, config.topics],
  );
  const screensUrl = origin && sp ? `${origin}/screens?s=${encodeURIComponent(sp)}` : "";
  const enabledCount = config.topics.filter((t) => isTopicEnabled(t)).length;

  const statusText =
    status === "connected"
      ? "已連線"
      : status === "connecting"
        ? "連線中…"
        : status === "disconnected"
          ? "已中斷，重新連線中…"
          : `連線失敗：${error}`;

  async function tryUnlock() {
    const result = await unlock(keyPassword);
    if (result === "ok") {
      setKeyPassword("");
      setKeyPasswordError("");
    } else if (result === "no_store") {
      setKeyPasswordError("請先在上方連線 Google 試算表，才能驗證主辦密碼");
    } else if (result === "password_not_set") {
      setKeyPasswordError("試算表的 Apps Script 還沒設定 HOST_PASSWORD（指令碼屬性）");
    } else if (result === "network") {
      setKeyPasswordError("連不上試算表，請稍後再試");
    } else {
      setKeyPasswordError("密碼錯誤");
    }
  }

  function chooseMode(next: "local" | "sync") {
    if (next === choice) return;
    if (next === "local" && scriptUrl) {
      if (
        !window.confirm(
          "要改用單機模式嗎？\n這台電腦會中斷與 Google 試算表的連線，之後的設定與投稿只存在這台電腦。試算表裡原有的資料不會被刪除。",
        )
      )
        return;
      try {
        window.sessionStorage.setItem("wc:nextChoice", "local");
      } catch {
        /* ignore */
      }
      setScriptUrl("");
      window.location.reload();
      return;
    }
    setChoice(next);
  }

  async function connectSheet() {
    const parsed = parseScriptUrl(scriptInput);
    if (!parsed) {
      setConnNote("網址格式不對，請貼上 Apps Script 部署後的「網頁應用程式網址」（結尾是 /exec）");
      return;
    }
    setConnBusy(true);
    setConnNote("連線測試中…");
    const ok = await testConnection(parsed);
    setConnBusy(false);
    if (!ok) {
      setConnNote("連線失敗：請確認已部署成「網頁應用程式」且「誰可以存取」選「所有人」");
      return;
    }
    // If the sheet already holds settings and this computer has its own, ask which to keep.
    const remote = await fetchConfigFromUrl(parsed);
    const localIsDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG);
    if (remote.ok && remote.config && !localIsDefault) {
      const useSheet = window.confirm(
        "這份試算表裡已經有活動設定，這台電腦也有自己的設定。\n\n按「確定」＝使用試算表裡的設定（這台目前的設定會被取代）。\n按「取消」＝保留這台電腦的設定（解鎖後會覆蓋試算表裡的設定）。",
      );
      try {
        if (useSheet) window.localStorage.removeItem(PREFER_LOCAL_FLAG);
        else window.localStorage.setItem(PREFER_LOCAL_FLAG, "1");
      } catch {
        /* ignore */
      }
    } else {
      try {
        window.localStorage.removeItem(PREFER_LOCAL_FLAG);
      } catch {
        /* ignore */
      }
    }
    try {
      window.sessionStorage.setItem("wc:nextChoice", "sync");
    } catch {
      /* ignore */
    }
    setScriptUrl(parsed);
    window.location.reload();
  }

  async function uploadLocalData() {
    if (localItems.length === 0) return;
    const names = localItems.map((i) => `「${i.name}」`).join("、");
    if (
      !window.confirm(
        `要把這台電腦上的投稿資料（${names}）合併上傳到你的試算表嗎？\n上傳成功後，這台電腦上的本機資料會被清除，避免重複上傳。`,
      )
    )
      return;
    setUploadNote("上傳中…");
    for (const item of localItems) {
      const remoteData = await fetchRemoteData(config.room, item.id);
      const merged = mergeTopicData(remoteData ?? { counts: {}, records: [] }, item.data);
      const ok = await replaceRemoteData(config.room, item.id, merged);
      if (!ok) {
        setUploadNote(`「${item.name}」上傳失敗：請確認已用主辦密碼解鎖、設定已同步到試算表，再試一次。`);
        return;
      }
      for (const k of item.keys) {
        try {
          window.localStorage.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
    setLocalItems(scanLocalData(config.topics));
    setUploadNote("已上傳完成，本機資料已清除。");
  }

  async function copyScriptCode() {
    try {
      await navigator.clipboard.writeText(appsScriptCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 3000);
    } catch {
      window.alert("無法自動複製，請改開專案裡的 apps-script/Code.gs 手動複製。");
    }
  }

  function disconnectSheet() {
    if (!window.confirm("要中斷與 Google 試算表的連線嗎？（試算表裡的資料不會被刪除）")) return;
    try {
      window.sessionStorage.setItem("wc:nextChoice", "local");
    } catch {
      /* ignore */
    }
    setScriptUrl("");
    window.location.reload();
  }

  function saveApiKey() {
    window.localStorage.setItem(LOCAL_KEY_STORAGE, apiKey.trim());
    resetAblyClient();
    setSavedNote("已儲存，重新整理後生效");
    window.setTimeout(() => setSavedNote(""), 3000);
  }

  function saveBlocklist() {
    const words = extraWords
      .split(/[,，、\s]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    saveExtraBlocklist(words);
    update({ ...config, extraBlocklist: words });
    setSavedNote("敏感詞已更新");
    window.setTimeout(() => setSavedNote(""), 3000);
  }

  function addTopic() {
    if (config.topics.length >= MAX_TOPICS) return;
    const id = nextTopicId(config.topics);
    const newTopic: TopicConfig = {
      id,
      name: `主題 ${id}`,
      maxLength: DEFAULT_TOPIC_MAX_LENGTH,
      mode: "cloud",
      enabled: false,
    };
    update({ ...config, topics: [...config.topics, newTopic] });
  }

  async function removeTopic(id: string) {
    if (config.topics.length <= MIN_TOPICS) return;
    if (cloud === "on" && !unlocked) {
      window.alert("請先在上方輸入主辦密碼解鎖，才能刪除主題。");
      return;
    }
    const topic = config.topics.find((t) => t.id === id);
    const name = topic?.name ?? id;
    const existing =
      cloud === "on" ? await fetchRemoteData(config.room, id) : loadTopicData(config.room, id);
    const hasData = existing
      ? Object.keys(existing.counts).length > 0 || existing.records.length > 0
      : topicHasData(config.room, id);
    if (hasData && existing) {
      const wantExport = window.confirm(
        `「${name}」已有投稿資料。\n\n要先匯出成 Excel 嗎？\n按「確定」＝先匯出；按「取消」＝不匯出。`,
      );
      if (wantExport) await downloadXlsx(name, existing);
    }
    if (
      !window.confirm(
        `確定刪除「${name}」？\n該主題的大螢幕網址將失效，所有暫存的投稿資料也會一併刪除，無法復原。`,
      )
    )
      return;
    if (cloud === "on") {
      const ok = await replaceRemoteData(config.room, id, null);
      if (!ok) {
        window.alert("雲端資料刪除失敗，主題未刪除，請稍後再試。");
        return;
      }
    }
    removeTopicData(config.room, id);
    update({ ...config, topics: config.topics.filter((t) => t.id !== id) });
  }

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground">主辦方控制台</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              設定房間與主題（可自行新增或刪除），產生掃碼網址，每個主題對應一台大螢幕。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm">
            <span
              className={
                "inline-block h-2.5 w-2.5 rounded-full " +
                (status === "connected"
                  ? "bg-primary"
                  : status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground animate-pulse")
              }
            />
            {statusText}
          </div>
        </header>

        <section className="mt-6">
          <h2 className="text-base font-bold text-foreground">你要怎麼使用？</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseMode("local")}
              className={
                "rounded-2xl border p-5 text-left transition " +
                (choice === "local"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-secondary")
              }
            >
              <p className="text-lg font-bold text-foreground">
                {choice === "local" ? "● " : "○ "}單機模式
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                只用這一台電腦，最簡單，不需要 Google 帳號。大螢幕在這台電腦另開視窗（可拖到外接螢幕）。
              </p>
            </button>
            <button
              type="button"
              onClick={() => chooseMode("sync")}
              className={
                "rounded-2xl border p-5 text-left transition " +
                (choice === "sync"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-secondary")
              }
            >
              <p className="text-lg font-bold text-foreground">
                {choice === "sync" ? "● " : "○ "}多機同步模式
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                用你自己的 Google 試算表。A 管理、B 大螢幕、C 投稿可以分在不同電腦。需一次性設定（約 5 分鐘）。
              </p>
            </button>
          </div>
        </section>

        {choice === null ? (
          <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            請先選擇上面的使用方式，才會顯示設定與主題管理。
          </p>
        ) : (
          <>
        {choice === "sync" ? (
          <>
        <div
          className={
            "mt-5 rounded-xl border px-4 py-3 text-sm " +
            (link === "unreachable"
              ? "border-destructive bg-destructive/10 text-destructive"
              : link === "synced"
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground")
          }
        >
          {link === "local"
            ? "目前模式：單機。設定與資料只存在這台電腦的瀏覽器，其他電腦看不到。要多台電腦共用，請在下方連線你的 Google 試算表。"
            : link === "checking"
              ? "目前模式：多機同步。正在檢查試算表連線…"
              : link === "synced"
                ? "目前模式：多機同步。已連線到你的試算表，設定與投稿會在所有電腦間共用。"
                : "⚠ 連不上你的試算表（網路問題，或 Apps Script 暫時沒有回應）。為避免設定不同步，編輯已暫停，每 10 秒自動重試。"}
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-bold text-foreground">Google 試算表連線</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            設定、主題與每個主題的投稿都存在你自己的試算表，多台電腦因此能共用。步驟見專案的 README，Apps Script 程式在 apps-script/Code.gs。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={scriptInput}
              onChange={(e) => {
                setScriptInput(e.target.value);
                setConnNote("");
              }}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              onClick={() => void connectSheet()}
              disabled={connBusy}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              連線並測試
            </button>
            {scriptUrl ? (
              <button
                onClick={disconnectSheet}
                className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-secondary"
              >
                中斷連線
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {connNote || (scriptUrl ? "✅ 已連線到你的試算表" : "尚未連線：目前設定與資料只存在這台電腦的瀏覽器。")}
          </p>
        </section>

        {scriptUrl && localItems.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-border bg-card p-5">
            <h2 className="text-base font-bold text-foreground">這台電腦有單機時期的投稿資料</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {localItems.map((i) => `${i.name}（${Object.keys(i.data.counts).length} 個詞彙）`).join("、")}
              。可一鍵合併上傳到試算表（需先用主辦密碼解鎖並完成同步）。
            </p>
            <button
              onClick={() => void uploadLocalData()}
              className="mt-3 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              上傳本機資料到試算表
            </button>
            {uploadNote ? <p className="mt-2 text-xs text-muted-foreground">{uploadNote}</p> : null}
          </section>
        ) : null}

        <details open={!scriptUrl} className="mt-6 rounded-2xl border border-border bg-card p-5">
          <summary className="cursor-pointer text-base font-bold text-foreground">
            第一次使用？Google 試算表設定教學
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>建立一份新的 Google 試算表（或打開你的範本副本）。</li>
            <li>
              選單「擴充功能 → Apps Script」，把編輯器裡原本的內容全部刪掉，貼上下面複製的程式並儲存：
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void copyScriptCode()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {codeCopied ? "已複製 ✓" : "一鍵複製 Apps Script 程式"}
                </button>
              </div>
            </li>
            <li>回到試算表重新整理，選單會多出「點亮「心」光」，按「設定主辦密碼」輸入你的密碼（第一次需授權）。</li>
            <li>回到 Apps Script：右上「部署 → 新增部署作業」，類型選「網頁應用程式」，執行身分「我」、誰可以存取「所有人」，按部署並授權。</li>
            <li>複製「網頁應用程式網址」（結尾是 /exec），貼到上方「Google 試算表連線」，按「連線並測試」。</li>
            <li>在下方輸入主辦密碼解鎖，設定就會寫進試算表。</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            B、C 電腦與觀眾都不需要登入 Google；只有你設定時需要登入一次。之後若修改了 Apps Script 程式，要「管理部署作業 → 編輯 → 新版本」才會生效。
          </p>
        </details>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-foreground">主辦密碼與同步狀態</h2>
            <span className="text-xs text-muted-foreground">
              {cloud === "checking"
                ? "檢查雲端中…"
                : cloud === "off"
                  ? "雲端同步：未啟用（設定與資料只存在這台電腦的瀏覽器）"
                  : sync === "saving"
                    ? "雲端同步：儲存中…"
                    : sync === "error"
                      ? "雲端同步：儲存失敗，請稍後再試"
                      : sync === "locked"
                        ? "雲端同步：已開啟，但尚未解鎖，修改不會同步"
                        : "雲端同步：已開啟，所有電腦共用同一份設定與資料"}
            </span>
          </div>
          {unlocked ? (
            <div className="mt-3 flex items-center gap-3 text-sm text-foreground">
              <span>🔓 已解鎖</span>
              <button type="button" onClick={lock} className="text-xs text-muted-foreground underline">
                重新鎖定
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                輸入主辦密碼（設在試算表 Apps Script 的 HOST_PASSWORD）後，才能把設定同步到試算表、刪除主題，以及查看與修改 Ably API Key。
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="password"
                  value={keyPassword}
                  onChange={(e) => {
                    setKeyPassword(e.target.value);
                    setKeyPasswordError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void tryUnlock();
                  }}
                  placeholder="主辦密碼"
                  className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                />
                <button
                  onClick={() => void tryUnlock()}
                  className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  解鎖
                </button>
              </div>
              {keyPasswordError ? <p className="mt-2 text-xs text-destructive">{keyPasswordError}</p> : null}
            </>
          )}
        </section>

          </>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
            目前是單機模式：設定與資料只存在這台電腦的瀏覽器，其他電腦看不到。
          </p>
        )}

        <fieldset
          disabled={link === "unreachable" || link === "checking"}
          className="mt-8 grid min-w-0 gap-6 border-0 p-0 disabled:opacity-60"
        >
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground">房間與主題</h2>

            <label className="mt-5 block text-sm font-medium text-muted-foreground">
              房間名稱（觀眾掃碼會帶入）
              <input
                value={config.room}
                onChange={(e) =>
                  update({ ...config, room: e.target.value.replace(/[\s/\\?&#%:"']/g, "").slice(0, 24) })
                }
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:border-primary"
                placeholder="main"
              />
            </label>

            <div className="mt-5 space-y-3">
              {config.topics.map((topic, i) => {
                const currentMax = topicSuggestedLength(topic);
                const currentMode = topicDefaultMode(topic);
                const changeMode = (mode: TopicMode) => {
                  if (mode === currentMode) return;
                  if (
                    !window.confirm(
                      `要把「${topic.name}」的預設樣式改成「${MODE_LABELS[mode]}」嗎？\n開啟中的大螢幕若沒有自己切換過樣式，重新整理後會改用新的預設。`,
                    )
                  )
                    return;
                  const topics = config.topics.slice();
                  // Move the suggested length along only if it was still the old style's default.
                  const wasDefault =
                    currentMax === (currentMode === "board" ? BOARD_SUGGESTED_LENGTH : DEFAULT_TOPIC_MAX_LENGTH);
                  topics[i] = {
                    ...topic,
                    mode,
                    maxLength: wasDefault
                      ? mode === "board"
                        ? BOARD_SUGGESTED_LENGTH
                        : DEFAULT_TOPIC_MAX_LENGTH
                      : currentMax,
                  };
                  update({ ...config, topics });
                };
                return (
                  <div key={topic.id} className="rounded-xl border border-border/60 p-3">
                    <div className="flex items-end gap-2">
                      <label className="block flex-1 text-sm font-medium text-muted-foreground">
                        主題 {topic.id} 名稱
                        <input
                          value={topic.name}
                          onChange={(e) => {
                            const topics = config.topics.slice();
                            topics[i] = { ...topic, name: e.target.value.slice(0, 20) };
                            update({ ...config, topics });
                          }}
                          className="mt-1.5 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:border-primary"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const topics = config.topics.slice();
                          topics[i] = { ...topic, enabled: !isTopicEnabled(topic) };
                          update({ ...config, topics });
                        }}
                        className={
                          "mb-0.5 shrink-0 rounded-xl border px-3 py-2.5 text-sm font-semibold " +
                          (isTopicEnabled(topic)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-secondary")
                        }
                      >
                        {isTopicEnabled(topic) ? "已啟用" : "啟用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeTopic(topic.id)}
                        disabled={config.topics.length <= MIN_TOPICS}
                        title={config.topics.length <= MIN_TOPICS ? "至少要保留一個主題" : "刪除此主題"}
                        className="mb-0.5 shrink-0 rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        刪除
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>建議字數</span>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={currentMax}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1)));
                          const topics = config.topics.slice();
                          topics[i] = { ...topic, maxLength: n };
                          update({ ...config, topics });
                        }}
                        className="w-20 rounded-lg border border-input bg-background px-2.5 py-1.5 text-foreground outline-none focus:border-primary"
                      />
                      <span>字（只是提示，觀眾超過也能送出，上限 200 字）</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>大螢幕預設樣式</span>
                      {(["cloud", "shape", "board"] as TopicMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => changeMode(m)}
                          className={
                            "rounded-full border px-3 py-1 text-xs font-medium " +
                            (currentMode === m
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-secondary")
                          }
                        >
                          {MODE_LABELS[m]}
                        </button>
                      ))}
                      {isTopicEnabled(topic) ? null : (
                        <span className="text-xs">尚未啟用，不會產生大螢幕連結與 QR Code</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addTopic}
                disabled={config.topics.length >= MAX_TOPICS}
                className="w-full rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {config.topics.length >= MAX_TOPICS ? `最多 ${MAX_TOPICS} 個主題` : "+ 新增主題"}
              </button>
            </div>

            <label className="mt-6 flex items-center gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={config.filterEnabled}
                onChange={(e) => update({ ...config, filterEnabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              啟用敏感詞過濾
            </label>

            <label className="mt-5 block text-sm font-medium text-muted-foreground">
              自訂敏感詞（以頓號或逗號分隔）
              <textarea
                value={extraWords}
                onChange={(e) => setExtraWords(e.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:border-primary"
              />
            </label>
            <button
              onClick={saveBlocklist}
              className="mt-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              儲存敏感詞
            </button>

            <div className="mt-8 border-t border-border pt-6">
              <h3 className="text-sm font-bold text-foreground">Ably API Key（選填）</h3>
              {keyAccess ? (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">
                    若伺服器已設定金鑰，這裡留空即可。填入後本機會改用這把金鑰連線（測試用）。
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="xxxxx.yyyyy:zzzzzzzz"
                      className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                    />
                    <button
                      onClick={saveApiKey}
                      className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      儲存
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  🔒 已鎖定，請先在頁面上方輸入主辦密碼解鎖。
                </p>
              )}
              {savedNote ? <p className="mt-2 text-xs text-primary">{savedNote}</p> : null}
            </div>
          </div>

        </fieldset>

        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">{sp ? "三個入口" : "投稿入口"}</h2>
          {sp ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                A 電腦用本頁管理主題；把下面兩個網址貼到其他電腦即可使用（網址已帶上試算表連線，不需再設定）。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                ⚠ 這些網址與 QR 會連到<strong>你的</strong>試算表，只用在你自己的活動。要把這個網站介紹給其他主辦者，請只給他首頁或 /host 網址，讓他連線自己的試算表。
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              單機模式：大螢幕請從下方各主題卡片的「開啟大螢幕」在這台電腦開啟。下面的電腦投稿網址可給需要用電腦輸入的人（需與這台電腦同時開著大螢幕）。
            </p>
          )}
          <div className="mt-4 space-y-4">
            {sp ? (
            <LinkRow
              title="投放大螢幕頁（給大螢幕電腦）"
              hint={sp ? "從試算表讀取主題，選要投放哪一個。" : "需先連線 Google 試算表才能使用。"}
              url={screensUrl}
            />
            ) : null}
            <LinkRow
              title="電腦投稿頁（給不方便用手機的人）"
              hint={
                enabledCount === 0
                  ? "請先啟用至少一個主題。"
                  : sp
                    ? `可切換所有「已啟用」的主題（目前 ${enabledCount} 個），每 10 秒自動更新主題清單。`
                    : `可切換所有「已啟用」的主題（目前 ${enabledCount} 個）。`
              }
              url={enabledCount === 0 ? "" : generalUrl}
            />
          </div>
        </section>

        {config.topics.every((t) => !isTopicEnabled(t)) ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            尚未啟用任何主題。請在上方主題旁按「啟用」，才會出現大螢幕連結與專屬 QR Code。
          </p>
        ) : null}
        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {config.topics.filter((t) => isTopicEnabled(t)).map((topic) => {
            const id = topic.id;
            const url = !origin
              ? ""
              : sp
                ? joinUrlCloud(origin, sp, id)
                : joinUrl(origin, config.room, config.topics, id);
            const screenHref = `${origin}/screen/${id}${sp ? `?s=${encodeURIComponent(sp)}` : ""}`;
            return (
              <div key={id} className="rounded-2xl border border-border bg-card p-5">
                <p className="text-xs tracking-widest text-muted-foreground">主題 {id}</p>
                <h3 className="mt-1 text-xl font-bold text-foreground">{topic.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  已累積 {counts[id] ?? 0} 個不重複詞彙
                </p>
                <div className="mt-4 flex justify-center">
                  {url ? <QrPanel url={url} size={150} label="此主題專屬 QR（只能投此主題）" /> : null}
                </div>
                <a
                  href={screenHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 block rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground"
                >
                  開啟大螢幕 /screen/{id}
                </a>
              </div>
            );
          })}
        </section>
          </>
        )}
      </div>
    </main>
  );
}

function LinkRow({ title, hint, url }: { title: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      {url ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            }}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            {copied ? "已複製 ✓" : "複製"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            開啟
          </a>
        </div>
      ) : null}
    </div>
  );
}
