import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { QrPanel } from "@/components/QrPanel";
import { useWordCloudConfig } from "@/hooks/use-wordcloud-config";
import { LOCAL_KEY_STORAGE, resetAblyClient, useAbly } from "@/lib/ably-client";
import {
  joinUrl,
  loadBlocklist,
  loadTopicData,
  MAX_TOPICS,
  MIN_TOPICS,
  nextTopicId,
  saveExtraBlocklist,
  type TopicConfig,
} from "@/lib/wordcloud-core";

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "主辦方控制台 | 實時互動文字雲" },
      {
        name: "description",
        content: "設定房間、主題名稱（數量可自行增減）與敏感詞過濾，產生觀眾掃碼 QR Code，並開啟對應的大螢幕文字雲。",
      },
      { property: "og:title", content: "主辦方控制台 | 實時互動文字雲" },
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
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
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

  const statusText =
    status === "connected"
      ? "已連線"
      : status === "connecting"
        ? "連線中…"
        : status === "disconnected"
          ? "已中斷，重新連線中…"
          : `連線失敗：${error}`;

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
    const newTopic: TopicConfig = { id, name: `主題 ${id}` };
    update({ ...config, topics: [...config.topics, newTopic] });
  }

  function removeTopic(id: string) {
    if (config.topics.length <= MIN_TOPICS) return;
    if (!window.confirm(`確定刪除「${config.topics.find((t) => t.id === id)?.name ?? id}」？該主題的大螢幕網址將失效（已累積的資料不會被刪除）。`))
      return;
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

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
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
              {config.topics.map((topic, i) => (
                <div key={topic.id} className="flex items-end gap-2">
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
                    onClick={() => removeTopic(topic.id)}
                    disabled={config.topics.length <= MIN_TOPICS}
                    title={config.topics.length <= MIN_TOPICS ? "至少要保留一個主題" : "刪除此主題"}
                    className="mb-0.5 shrink-0 rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    刪除
                  </button>
                </div>
              ))}
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
              {savedNote ? <p className="mt-2 text-xs text-primary">{savedNote}</p> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground">通用加入 QR Code</h2>
            <p className="mt-1 text-sm text-muted-foreground">掃碼後可自由切換所有主題。</p>
            <div className="mt-5 flex flex-col items-center">
              {generalUrl ? <QrPanel url={generalUrl} size={200} /> : null}
              <p className="mt-3 break-all text-center text-xs text-muted-foreground">{generalUrl}</p>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {config.topics.map((topic) => {
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
                  {url ? <QrPanel url={url} size={150} label="直接進入此主題" /> : null}
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
