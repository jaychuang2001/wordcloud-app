import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "實時互動文字雲 | 三主題大螢幕即時互動" },
      {
        name: "description",
        content:
          "支援 800 人同時參與的即時文字雲：三個主題、三台大螢幕、手機掃碼輸入，資料留存於本機並可匯出匯入 CSV。",
      },
      { property: "og:title", content: "實時互動文字雲 | 三主題大螢幕即時互動" },
      {
        property: "og:description",
        content: "手機掃碼即時送詞，大螢幕文字雲動態生長，支援形狀遮罩與跨天數據留存。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-accent/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <span className="rounded-full border border-border bg-card/60 px-4 py-1 text-xs tracking-widest text-muted-foreground">
          REAL-TIME WORD CLOUD
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight text-foreground sm:text-6xl">
          實時互動文字雲
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          現場觀眾掃碼輸入詞彙，三個主題、三台大螢幕各自即時生長文字雲。資料自動存在瀏覽器，隔天續用，並可匯出／匯入 CSV。
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/host"
            className="rounded-xl bg-primary px-8 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-90"
          >
            主辦方控制台
          </Link>
          <Link
            to="/join"
            className="rounded-xl border border-border bg-card px-8 py-3 text-base font-semibold text-foreground transition hover:bg-secondary"
          >
            我是觀眾，我要投稿
          </Link>
        </div>

        <ul className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
          {[
            { t: "三主題分流", d: "/screen/1、/screen/2、/screen/3 各自全螢幕投影。" },
            { t: "形狀遮罩", d: "上傳黑白圖形，文字完美填入輪廓。" },
            { t: "資料留存", d: "本機累積、CSV 匯出與歷史匯入合併。" },
          ].map((f) => (
            <li key={f.t} className="rounded-2xl border border-border bg-card/60 p-5">
              <p className="font-semibold text-foreground">{f.t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
