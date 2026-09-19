import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAbly } from "@/lib/ably-client";
import {
  channelName,
  DEFAULT_ROOM,
  isBlocked,
  loadBlocklist,
  MAX_WORD_LENGTH,
  normalizeWord,
  TOPIC_IDS,
  topicsFromSearch,
  type TopicId,
} from "@/lib/wordcloud-core";

const COOLDOWN_SECONDS = 10;

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "送出你的詞彙 | 實時互動文字雲" },
      {
        name: "description",
        content: "手機掃碼後選擇主題，輸入 1-3 個詞彙送出，立即出現在現場大螢幕的文字雲上。",
      },
      { property: "og:title", content: "送出你的詞彙 | 實時互動文字雲" },
      { property: "og:description", content: "選擇主題、輸入詞彙，即時投影到現場大螢幕。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JoinRoute,
});

function JoinRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <JoinPage />
    </ClientOnly>
  );
}

function JoinPage() {
  const { client, status, error } = useAbly();
  const [search, setSearch] = useState<URLSearchParams>(() => new URLSearchParams());
  const [active, setActive] = useState<TopicId>("1");
  const [words, setWords] = useState(["", "", ""]);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldowns, setCooldowns] = useState<Record<TopicId, number>>({ "1": 0, "2": 0, "3": 0 });
  const blocklist = useRef<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params);
    const t = params.get("topic");
    if (t && TOPIC_IDS.includes(t as TopicId)) setActive(t as TopicId);
    blocklist.current = loadBlocklist();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldowns((prev) => {
        if (!prev["1"] && !prev["2"] && !prev["3"]) return prev;
        return {
          "1": Math.max(0, prev["1"] - 1),
          "2": Math.max(0, prev["2"] - 1),
          "3": Math.max(0, prev["3"] - 1),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const room = search.get("room") || DEFAULT_ROOM;
  const topics = useMemo(() => topicsFromSearch(search), [search]);
  const activeTopic = topics.find((t) => t.id === active)!;
  const cooling = cooldowns[active] > 0;

  const statusText =
    status === "connected"
      ? "已連線"
      : status === "connecting"
        ? "連線中…"
        : status === "disconnected"
          ? "重新連線中…"
          : `連線失敗：${error}`;

  async function submit() {
    if (cooling) return;
    const cleaned = words.map(normalizeWord).filter(Boolean);
    if (cleaned.length === 0) {
      setMessage("請至少輸入一個詞彙");
      return;
    }
    const bad = cleaned.find((w) => isBlocked(w, blocklist.current));
    if (bad) {
      setMessage(`「${bad}」包含不適當用語，請換一個詞`);
      return;
    }
    if (!client || status !== "connected") {
      setMessage("尚未連線，請稍候再試");
      return;
    }
    try {
      const channel = client.channels.get(channelName(room, active));
      await channel.publish("word", { words: cleaned, ts: Date.now() });
      setWords(["", "", ""]);
      setMessage("送出成功！大螢幕上見 🎉");
      setSent(true);
      window.setTimeout(() => setSent(false), 1200);
      setCooldowns((prev) => ({ ...prev, [active]: COOLDOWN_SECONDS }));
    } catch {
      setMessage("送出失敗，請再試一次");
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>房間：{room}</span>
          <span className="flex items-center gap-1.5">
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (status === "connected"
                  ? "bg-primary"
                  : status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground animate-pulse")
              }
            />
            {statusText}
          </span>
        </div>

        <h1 className="mt-4 text-2xl font-black text-foreground">送出你的想法</h1>
        <p className="mt-1 text-sm text-muted-foreground">選擇主題，輸入 1～3 個詞彙。</p>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-border bg-card p-1.5">
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActive(t.id);
                setMessage("");
              }}
              className={
                "truncate rounded-xl px-2 py-2.5 text-sm font-semibold transition " +
                (active === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary")
              }
            >
              {t.name}
            </button>
          ))}
        </div>

        <section className="mt-5 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground">目前主題：{activeTopic.name}</p>
          <div className="mt-4 space-y-3">
            {words.map((w, i) => (
              <input
                key={i}
                value={w}
                maxLength={MAX_WORD_LENGTH}
                onChange={(e) => {
                  const next = words.slice();
                  next[i] = e.target.value;
                  setWords(next);
                  setMessage("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder={`詞彙 ${i + 1}${i === 0 ? "（必填）" : "（選填）"}`}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none focus:border-primary"
              />
            ))}
          </div>

          <button
            onClick={() => void submit()}
            disabled={cooling}
            className={
              "mt-5 w-full rounded-xl px-5 py-3.5 text-base font-bold transition " +
              (cooling
                ? "bg-secondary text-muted-foreground"
                : "bg-primary text-primary-foreground hover:opacity-90 " +
                  (sent ? "scale-[1.02]" : ""))
            }
          >
            {cooling ? `冷卻中 ${cooldowns[active]} 秒` : "送出"}
          </button>

          {message ? (
            <p
              className={
                "mt-3 text-center text-sm " + (sent ? "text-primary" : "text-muted-foreground")
              }
            >
              {message}
            </p>
          ) : null}
        </section>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          每個主題送出後需等待 {COOLDOWN_SECONDS} 秒才能再次投稿。
        </p>
      </div>
    </main>
  );
}
