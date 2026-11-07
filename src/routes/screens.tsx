import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { fetchRemoteConfig, getScriptUrl, scriptParam } from "@/lib/cloud";
import {
  isTopicEnabled,
  topicDefaultMode,
  type RoomConfig,
  type TopicMode,
} from "@/lib/wordcloud-core";

export const Route = createFileRoute("/screens")({
  head: () => ({
    meta: [
      { title: "投放大螢幕｜點亮「心」光" },
      { name: "description", content: "從試算表讀取主題，選擇要投放到這台大螢幕的主題。" },
      { property: "og:title", content: "投放大螢幕｜點亮「心」光" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ScreensRoute,
});

const MODE_LABELS: Record<TopicMode, string> = {
  cloud: "文字雲",
  shape: "形狀",
  board: "留言板",
};

function ScreensRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <ScreensPage />
    </ClientOnly>
  );
}

function ScreensPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [config, setConfig] = useState<RoomConfig | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [sp, setSp] = useState("");

  useEffect(() => {
    const url = getScriptUrl();
    setConnected(Boolean(url));
    setSp(url ? scriptParam(url) : "");
    if (!url) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetchRemoteConfig();
      if (cancelled) return;
      if (res.state === "on") {
        setFailed(false);
        setConfig(res.config);
      } else {
        setFailed(true);
        setConfig((prev) => prev ?? null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const topics = config ? config.topics.filter((t) => isTopicEnabled(t)) : [];

  return (
    <main className="min-h-screen bg-background px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-black text-foreground">投放大螢幕</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          選擇要在這台電腦的大螢幕上顯示哪一個主題。主題清單每 10 秒自動更新。
        </p>

        {connected === false ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            這台電腦還沒有連線到試算表。請回主辦方頁，複製「投放大螢幕頁」的網址再貼到這裡。
          </p>
        ) : config === undefined ? (
          <p className="mt-8 text-sm text-muted-foreground">讀取主題中…</p>
        ) : config === null ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            {failed
              ? "連不上試算表，請確認網路，稍後會自動重試。"
              : "主辦方尚未完成設定（需在主辦方頁輸入主辦密碼解鎖一次）。"}
          </p>
        ) : topics.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            目前沒有已啟用的主題。請主辦方在主辦方頁按下主題的「啟用」。
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {topics.map((t) => (
              <a
                key={t.id}
                href={`/screen/${t.id}?s=${encodeURIComponent(sp)}`}
                className="block rounded-2xl border border-border bg-card p-5 transition hover:bg-secondary"
              >
                <p className="text-xs tracking-widest text-muted-foreground">主題 {t.id}</p>
                <p className="mt-1 text-xl font-bold text-foreground">{t.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  預設樣式：{MODE_LABELS[topicDefaultMode(t)]}
                </p>
                <p className="mt-4 rounded-xl bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground">
                  投放此主題
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
