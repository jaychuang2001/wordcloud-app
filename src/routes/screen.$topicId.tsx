import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import {
  Download,
  EyeOff,
  Heart,
  ImagePlus,
  Maximize,
  Minimize,
  RotateCcw,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QrPanel } from "@/components/QrPanel";
import { Button } from "@/components/ui/button";
import { useWordCloudConfig } from "@/hooks/use-wordcloud-config";
import { useAbly } from "@/lib/ably-client";
import {
  channelName,
  downloadCsv,
  EMPTY_DATA,
  isBlocked,
  joinUrl,
  loadTopicData,
  mergeCsv,
  mergeWords,
  normalizeWord,
  paletteById,
  PALETTES,
  saveTopicData,
  TOPIC_IDS,
  toCsv,
  type TopicData,
  type TopicId,
} from "@/lib/wordcloud-core";
import { renderWordCloud, type MaskSource } from "@/lib/wordcloud-render";
import { renderHeartCloud } from "@/lib/heartcloud-render";

export const Route = createFileRoute("/screen/$topicId")({
  head: () => ({
    meta: [
      { title: "大螢幕文字雲 | 實時互動文字雲" },
      {
        name: "description",
        content: "單一主題的全螢幕即時文字雲，支援形狀遮罩、CSV 匯出匯入與現場掃碼 QR Code。",
      },
      { property: "og:title", content: "大螢幕文字雲 | 實時互動文字雲" },
      { property: "og:description", content: "現場投影的即時文字雲畫面。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScreenRoute,
  errorComponent: () => <Centered text="畫面載入失敗，請重新整理。" />,
  notFoundComponent: () => <Centered text="找不到這個主題，請使用 /screen/1～3。" />,
});

function Centered({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center text-muted-foreground">
      {text}
    </div>
  );
}

function ScreenRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <ScreenPage />
    </ClientOnly>
  );
}

function ScreenPage() {
  const { topicId: raw } = Route.useParams();
  const topicId = (TOPIC_IDS.includes(raw as TopicId) ? raw : "1") as TopicId;
  const { config, ready } = useWordCloudConfig();
  const { client, status, error } = useAbly();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const maskRef = useRef<HTMLInputElement | null>(null);
  const dataRef = useRef<TopicData>(EMPTY_DATA);
  const pendingRef = useRef<{ words: string[]; ts: number }[]>([]);
  const idleTimerRef = useRef<number | null>(null);

  const [data, setData] = useState<TopicData>(EMPTY_DATA);
  const [mask, setMask] = useState<MaskSource>(null);
  const [paletteId, setPaletteId] = useState("grey-wall");
  const [rotate, setRotate] = useState(true);
  const [cloudMode, setCloudMode] = useState<"text" | "heart">("text");
  const [panel, setPanel] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [origin, setOrigin] = useState("");

  const palette = paletteById(paletteId);
  const topic = config.topics.find((t) => t.id === topicId);
  const topicName = topic?.name ?? `主題 ${topicId}`;

  useEffect(() => setOrigin(window.location.origin), []);

  const showControls = useCallback(() => {
    if (document.fullscreenElement) return;
    setControlsVisible(true);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 7000);
  }, []);

  useEffect(() => {
    showControls();
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      if (active) {
        setPanel(false);
        setControlsVisible(false);
      } else showControls();
    };
    window.addEventListener("pointermove", showControls);
    window.addEventListener("keydown", showControls);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      window.removeEventListener("pointermove", showControls);
      window.removeEventListener("keydown", showControls);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [showControls]);

  // Load stored data whenever the room/topic changes.
  useEffect(() => {
    if (!ready) return;
    const loaded = loadTopicData(config.room, topicId);
    dataRef.current = loaded;
    setData(loaded);
  }, [config.room, topicId, ready]);

  // Subscribe to the topic channel; buffer bursts and flush every 400ms.
  useEffect(() => {
    if (!client || !ready) return;
    const channel = client.channels.get(channelName(config.room, topicId));
    const onMessage = (msg: { data?: unknown }) => {
      const payload = msg.data as { words?: unknown; ts?: unknown } | undefined;
      const words = Array.isArray(payload?.words)
        ? (payload!.words as unknown[])
            .map((w) => normalizeWord(String(w)))
            .filter((w) => w.length > 0)
            .filter((w) => !config.filterEnabled || !isBlocked(w))
        : [];
      if (words.length === 0) return;
      pendingRef.current.push({ words, ts: Number(payload?.ts) || Date.now() });
    };
    void channel.subscribe("word", onMessage);

    const timer = window.setInterval(() => {
      const batch = pendingRef.current;
      if (batch.length === 0) return;
      pendingRef.current = [];
      let next = dataRef.current;
      for (const item of batch) next = mergeWords(next, item.words, item.ts);
      dataRef.current = next;
      saveTopicData(config.room, topicId, next);
      setData(next);
    }, 400);

    return () => {
      window.clearInterval(timer);
      channel.unsubscribe("word", onMessage);
    };
  }, [client, config.room, config.filterEnabled, topicId, ready]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(320, Math.floor(wrap.clientWidth * dpr));
    canvas.height = Math.max(240, Math.floor(wrap.clientHeight * dpr));
    if (cloudMode === "heart") {
      void renderHeartCloud({ canvas, counts: dataRef.current.counts, palette, mask });
    } else {
      void renderWordCloud({ canvas, counts: dataRef.current.counts, palette, mask, rotate });
    }
  }, [palette, mask, rotate, cloudMode]);

  useEffect(() => {
    draw();
  }, [draw, data]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  function applyData(next: TopicData) {
    dataRef.current = next;
    saveTopicData(config.room, topicId, next);
    setData(next);
  }

  function onMaskFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setMask({ dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function onCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => applyData(mergeCsv(dataRef.current, String(reader.result)));
    reader.readAsText(file);
  }

  function clearAll() {
    if (!window.confirm(`確定清空「${topicName}」的所有資料？此動作無法復原。`)) return;
    applyData({ counts: {}, records: [] });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  const joinLink = useMemo(
    () => (origin ? joinUrl(origin, config.room, config.topics, topicId) : ""),
    [origin, config.room, config.topics, topicId],
  );

  const totalWords = Object.keys(data.counts).length;
  const totalEntries = data.records.length;
  const statusText =
    status === "connected"
      ? "已連線"
      : status === "connecting"
        ? "連線中…"
        : status === "disconnected"
          ? "重新連線中…"
          : `連線失敗：${error}`;

  return (
    <main className="relative h-screen w-screen overflow-hidden" style={{ background: palette.background }}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute left-8 top-6 text-projection-foreground">
        <p className="text-xs uppercase text-projection-muted">主題 {topicId}</p>
        <h1 className="mt-1 text-4xl font-black drop-shadow-lg">{topicName}</h1>
        <p className="mt-2 text-sm text-projection-muted">
          {totalWords} 個詞彙 · {totalEntries} 則投稿 · {statusText}
        </p>
      </div>

      {joinLink ? (
        <div className="absolute right-8 top-6 text-center text-projection-foreground">
          <QrPanel url={joinLink} size={140} />
          <p className="mt-2 text-xs text-projection-muted">掃碼加入此主題</p>
        </div>
      ) : null}

      {!fullscreen ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          title={panel ? "隱藏控制列" : "顯示控制列"}
          aria-label={panel ? "隱藏控制列" : "顯示控制列"}
          onClick={() => {
            setPanel((v) => !v);
            showControls();
          }}
          className={`absolute bottom-6 left-6 z-30 border border-projection-border bg-projection-panel text-projection-foreground shadow-2xl backdrop-blur-xl transition-opacity duration-300 hover:bg-projection-panel-hover ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          {panel ? <EyeOff /> : <Minimize />}
        </Button>
      ) : null}

      {panel && !fullscreen ? (
        <div className={`absolute bottom-6 left-1/2 z-20 flex max-w-[calc(100vw-9rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-projection-border bg-projection-panel p-2 text-projection-foreground shadow-2xl backdrop-blur-xl transition-all duration-300 ${controlsVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}>
          <span className="px-2 text-xs font-bold uppercase text-projection-muted">投影配色</span>
          <div className="flex items-center gap-1 border-r border-projection-border pr-2">
            {PALETTES.slice(0, 4).map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPaletteId(item.id)}
                aria-pressed={paletteId === item.id}
                className={paletteId === item.id ? "border border-projection-border bg-projection-active text-projection-foreground" : "text-projection-muted hover:bg-projection-panel-hover hover:text-projection-foreground"}
              >
                <span className={`size-3 rounded-full border border-projection-border palette-swatch-${item.id}`} />
                {item.name}
              </Button>
            ))}
          </div>
          <ScreenButton label={rotate ? "關閉文字傾斜" : "開啟文字傾斜"} onClick={() => setRotate((v) => !v)} icon={<RotateCcw />} />
          <ScreenButton
            label={cloudMode === "heart" ? "切換回文字雲" : "切換成愛心模式"}
            onClick={() => setCloudMode((m) => (m === "heart" ? "text" : "heart"))}
            icon={cloudMode === "heart" ? <Type /> : <Heart />}
          />
          <ScreenButton label="上傳形狀遮罩" onClick={() => maskRef.current?.click()} icon={<ImagePlus />} />
          {mask ? <ScreenButton label="移除遮罩" onClick={() => setMask(null)} icon={<Trash2 />} /> : null}
          <ScreenButton label="匯出 CSV" onClick={() => downloadCsv(`${config.room}-topic${topicId}.csv`, toCsv(data, topicName))} icon={<Download />} />
          <ScreenButton label="匯入歷史 CSV" onClick={() => fileRef.current?.click()} icon={<Upload />} />
          <ScreenButton label="進入全螢幕" onClick={toggleFullscreen} icon={<Maximize />} />
          <ScreenButton label="清空資料" onClick={clearAll} icon={<Trash2 />} danger />
        </div>
      ) : null}

      <input
        ref={maskRef}
        type="file"
        accept="image/png,image/svg+xml,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onMaskFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onCsvFile(f);
          e.target.value = "";
        }}
      />
    </main>
  );
}

function ScreenButton({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={danger ? "destructive" : "ghost"}
      size="icon"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={danger ? undefined : "text-projection-muted hover:bg-projection-panel-hover hover:text-projection-foreground"}
    >
      {icon}
    </Button>
  );
}
