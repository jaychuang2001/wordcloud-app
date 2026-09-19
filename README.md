# 實時互動文字雲

三主題大螢幕即時互動文字雲：主辦方設定房間與主題、觀眾掃碼輸入詞彙、大螢幕即時生長文字雲，資料可匯出／匯入 CSV。

以 [TanStack Start](https://tanstack.com/start) + React + TypeScript + Tailwind CSS 建置，即時通訊使用 [Ably](https://ably.com)。

## 本機開發

需要 Node.js 20+（或 Bun）。

```sh
npm install
cp .env.example .env   # 填入你自己的 ABLY_API_KEY（見下方）
npm run dev
```

開啟 http://localhost:3000

- `/` 首頁
- `/host` 主辦方控制台（設定房間、主題、敏感詞、產生 QR Code）
- `/join` 觀眾輸入頁
- `/screen/$topicId` 大螢幕文字雲

### 取得 Ably API Key

到 [ably.com](https://ably.com) 免費註冊，建立一個 App 後在 API Keys 頁面複製 key（格式為 `appId.keyId:keySecret`），貼到 `.env` 的 `ABLY_API_KEY`。

沒有設定伺服器端 key 也能跑：`/host` 頁面下方有「Ably API Key（選填）」欄位，可以在瀏覽器端暫時填入 key 做測試，但正式使用建議一律走伺服器端 key，金鑰才不會外流到觀眾端。

## 部署

這是標準的 TanStack Start 專案，可以部署到以下任一平台，做法都是「接上 GitHub repo、設定環境變數、自動部署」，跟這裡用什麼工具開發完全無關：

- **Vercel** — 官方支援，透過 Nitro 自動偵測，免額外設定
- **Netlify** — 官方 `@netlify/vite-plugin-tanstack-start`
- **Cloudflare Workers** — 官方 `@cloudflare/vite-plugin`
- **Railway / 自架 Node server** — `npm run build` 後 `node .output/server/index.mjs`

無論選哪個平台，記得在平台的環境變數設定裡加上：

```
ABLY_API_KEY=你的金鑰
```

## 技術棧

- TanStack Start（SSR、file-based routing、server functions）
- TypeScript
- React 19
- Tailwind CSS 4
- Ably（即時 pub/sub）
- wordcloud2.js（文字雲渲染）
