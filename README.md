# 實時互動文字雲

多主題大螢幕即時互動文字雲：主辦方設定房間與主題（數量可自行增減）、觀眾掃碼輸入詞彙、大螢幕即時生長文字雲，資料可匯出／匯入 Excel（.xlsx，含每筆投稿時間）。

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

## 多台電腦共用（Google 試算表）

沒有連線試算表時，設定與投稿資料只存在各電腦自己的瀏覽器。連線**你自己的** Google 試算表後，A 電腦管理主題、B 電腦投放大螢幕、C 電腦投稿，三台就能共用同一份設定與資料。每位主辦者都用自己的試算表，互不影響。

### 一次性設定（約 5 分鐘）

1. 建立一份新的 Google 試算表（或用現有的）。
2. 選單「擴充功能 → Apps Script」，把專案裡 `apps-script/Code.gs` 的內容整份貼上取代並儲存（也可在網站 `/host` 頁的「設定教學」按「一鍵複製 Apps Script 程式」）。
3. 回到試算表重新整理，選單會多出「點亮「心」光 → 設定主辦密碼」，輸入你的密碼（第一次需授權）。也可以改在 Apps Script 的「專案設定 → 指令碼屬性」新增 `HOST_PASSWORD`。
4. 右上「部署 → 新增部署作業」→ 類型選「網頁應用程式」，執行身分「我」、誰可以存取「所有人」→ 部署（第一次會要求授權）。
5. 複製「網頁應用程式網址」（結尾 `/exec`）。
6. 打開網站的 `/host`，貼到「Google 試算表連線」→「連線並測試」。
7. 輸入主辦密碼解鎖，設定會自動寫進試算表（出現「設定」與各主題的工作表）。

之後改了 `Code.gs`，要在 Apps Script「管理部署作業 → 編輯 → 新版本」才會生效。

### 三個入口

- **A（主題管理）**：`/host`，建立主題、啟用、設定樣式，每 10 秒更新各主題投稿數。
- **B（投放大螢幕）**：把 host 頁的「投放大螢幕頁」網址貼到大螢幕電腦，選要投放的主題。
- **C（電腦投稿）**：把「電腦投稿頁」網址貼到電腦，主題清單每 10 秒自動更新。

網址內已帶上試算表連線，貼過去就能用，不需再設定。

### 單機與多機同步

- **單機模式**：沒有連線試算表。設定與資料只存在這台電腦的瀏覽器，host 頁最上方會顯示「目前模式：單機」。
- **多機同步模式**：連線了試算表。host 頁會顯示「已連線」；連不上時會顯示警告、暫停編輯，並每 10 秒自動重試。
- **從單機改成多機**：連線時若試算表已有設定，會詢問要用試算表的還是這台的；這台若有單機時期累積的投稿，host 頁會出現「上傳本機資料到試算表」按鈕（合併上傳後會清除本機資料）。

### 製作範本（選用，讓別人一鍵複製）

1. 照上面「一次性設定」的步驟 1、2 做好一份試算表（不要設密碼、不要部署）。
2. 在試算表「共用」設定為「知道連結的任何人都可以檢視」。
3. 取得試算表網址，把結尾的 `/edit…` 改成 `/copy`，這個網址就是「建立副本」連結。
4. 別人開啟連結、按「建立副本」，程式會一起複製；他只需照步驟 3 到 6 設密碼、部署、貼網址即可。

## 分享給其他人使用

- **共用同一個網站**：把網站首頁或 `/host` 網址給對方，他自己連線他自己的 Google 試算表，資料互不影響。請不要把你自己帶 `?s=` 的連結（投放大螢幕頁、電腦投稿頁、QR）給別人，那會連到你的試算表。Ably 額度仍算在部署這個網站的人身上。
- **各自部署（資料與額度完全獨立）**：
  1. 在 GitHub 按 Fork（或下載後上傳到自己的 repo）。
  2. 到 [Vercel](https://vercel.com) 用 GitHub 登入，Add New → Project，選這個 repo，直接部署。
  3. 到 [Ably](https://ably.com) 註冊並建立 App，複製 API Key。
  4. 在 Vercel 專案的 Settings → Environment Variables 新增 `ABLY_API_KEY`，值貼上金鑰，重新部署。
  5. 打開自己的網站，照上面「一次性設定」連線自己的 Google 試算表。
