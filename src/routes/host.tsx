import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { QrPanel } from "@/components/QrPanel";
import { useWordCloudConfig } from "@/hooks/use-wordcloud-config";
import { LOCAL_KEY_STORAGE, resetAblyClient, useAbly } from "@/lib/ably-client";
import {
  BOARD_SUGGESTED_LENGTH,
  csvFilename,
  DEFAULT_TOPIC_MAX_LENGTH,
  downloadCsv,
  isTopicEnabled,
  joinUrl,
  loadBlocklist,
  loadTopicData,
  MAX_TOPICS,
  MIN_TOPICS,
  nextTopicId,
  removeTopicData,
  saveExtraBlocklist,
  toCsv,
  topicDefaultMode,
  topicHasData,
  topicSuggestedLength,
  type TopicConfig,
  type TopicMode,
} from "@/lib/wordcloud-core";

// Client-side gate only (anyone reading the page source could find it) — it keeps
// casual users from editing the Ably key, it is not real security.
const KEY_PASSWORD = "1213";
const KEY_UNLOCK_FLAG = "wc:keyUnlocked";

const MODE_LABELS: Record<TopicMode, string> = {
  cloud: "文字雲",
  shape: "形狀（愛心／星星／雲朵／天燈）",
  board: "留言板",
};

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
  const { config, update, ready } = useWordCloudConfig();
  const { status, error } = useAbly();
  const [origin, setOrigin] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extraWords, setExtraWords] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [keyUnlocked, setKeyUnlocked] = useState(false);
  const [keyPassword, setKeyPassword] = useState("");
  const [keyPasswordError, setKeyPasswordError] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setKeyUnlocked(window.sessionStorage.getItem(KEY_UNLOCK_FLAG) === "1");
    } catch {
      /* ignore */
    }
    setApiKey(window.localStorage.getItem(LOCAL_KEY_STORAGE) ?? "");
    const built = loadBlocklist();
    const stored = window.localStorage.getItem("wc:blocklist");
    setExtraWords(stored ? (JSON.parse(stored) as string[]).join("、") : "");
    void built;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const refresh = () => {
      const next: Record<string, number> = {};
      for (const t of config.topics) {
        next[t.id] = Object.keys(loadTopicData(config.room, t.id).counts).length;
      }
      setCounts(next);
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [config.room, config.topics, ready]);

  const generalUrl = useMemo(
    () => (origin ? joinUrl(origin, config.room, config.topics) : ""),
    [origin, config.room, config.topics],
  );
  const enabledCount = config.topics.filter((t) => isTopicEnabled(t)).length;

  const statusText =
    status === "connected"
      ? "已連線"
      : status === "connecting"
        ? "連線中…"
        : status === "disconnected"
          ? "已中斷，重新連線中…"
          : `連線失敗：${error}`;

  function tryUnlock() {
    if (keyPassword === KEY_PASSWORD) {
      setKeyUnlocked(true);
      setKeyPassword("");
      setKeyPasswordError("");
      try {
        window.sessionStorage.setItem(KEY_UNLOCK_FLAG, "1");
      } catch {
        /* ignore */
      }
    } else {
      setKeyPasswordError("密碼錯誤");
    }
  }

  function lockKey() {
    setKeyUnlocked(false);
    try {
      window.sessionStorage.removeItem(KEY_UNLOCK_FLAG);
    } catch {
      /* ignore */
    }
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

  function removeTopic(id: string) {
    if (config.topics.length <= MIN_TOPICS) return;
    const topic = config.topics.find((t) => t.id === id);
    const name = topic?.name ?? id;
    if (topicHasData(config.room, id)) {
      const wantExport = window.confirm(
        `「${name}」已有投稿資料。\n\n要先匯出成 CSV 嗎？\n按「確定」＝先匯出；按「取消」＝不匯出。`,
      );
      if (wantExport) {
        downloadCsv(csvFilename(name), toCsv(loadTopicData(config.room, id), name));
      }
    }
    if (
      !window.confirm(
        `確定刪除「${name}」？\n該主題的大螢幕網址將失效，所有暫存的投稿資料也會一併刪除，無法復原。`,
      )
    )
      return;
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

        <section className="mt-8 grid gap-6">
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
                        onClick={() => removeTopic(topic.id)}
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">Ably API Key（選填）</h3>
                {keyUnlocked ? (
                  <button type="button" onClick={lockKey} className="text-xs text-muted-foreground underline">
                    重新鎖定
                  </button>
                ) : null}
              </div>
              {keyUnlocked ? (
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
                <>
                  <p className="mt-1 text-xs text-muted-foreground">🔒 已鎖定，輸入權限密碼後才能查看與修改。</p>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={keyPassword}
                      onChange={(e) => {
                        setKeyPassword(e.target.value);
                        setKeyPasswordError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") tryUnlock();
                      }}
                      placeholder="權限密碼"
                      className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                    />
                    <button
                      onClick={tryUnlock}
                      className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      解鎖
                    </button>
                  </div>
                  {keyPasswordError ? <p className="mt-2 text-xs text-destructive">{keyPasswordError}</p> : null}
                </>
              )}
              {savedNote ? <p className="mt-2 text-xs text-primary">{savedNote}</p> : null}
            </div>
          </div>

        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground">通用輸入網址（給用電腦的人）</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            這個網址可自由切換所有「已啟用」的主題（目前 {enabledCount} 個），不需掃碼。手機掃碼仍請用各主題的專屬 QR。
          </p>
          {enabledCount === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">請先啟用至少一個主題。</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={generalUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(generalUrl);
                  setSavedNote("已複製通用網址");
                  window.setTimeout(() => setSavedNote(""), 3000);
                }}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                複製
              </button>
              <a
                href={generalUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                開啟
              </a>
            </div>
          )}
        </section>

        {config.topics.every((t) => !isTopicEnabled(t)) ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            尚未啟用任何主題。請在上方主題旁按「啟用」，才會出現大螢幕連結與專屬 QR Code。
          </p>
        ) : null}
        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {config.topics.filter((t) => isTopicEnabled(t)).map((topic) => {
            const id = topic.id;
            const url = origin ? joinUrl(origin, config.room, config.topics, id) : "";
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
                <Link
                  to="/screen/$topicId"
                  params={{ topicId: id }}
                  target="_blank"
                  className="mt-4 block rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground"
                >
                  開啟大螢幕 /screen/{id}
                </Link>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
