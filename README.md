# china-train

Train ticket search for **Hong Kong ↔ Ping Shan** (via Shenzhen North). A client-only wrapper around the 聚合数据 "12306火车票时刻表余票查询服务" API on the [Alibaba Cloud API Marketplace](https://market.aliyun.com/detail/cmapi00071761): you provide your own APPCODE and the app calls the upstream API from your browser (the gateway allows CORS), then computes and displays transfer options.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run locally:

   ```bash
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173) (or the URL Vite prints).

3. Subscribe to the API on the [Alibaba Cloud API Marketplace](https://market.aliyun.com/detail/cmapi00071761) (there is a ¥2 / 100-call trial tier) and enter the APPCODE in the app. It is stored only in your browser (cookie).

Notes on the upstream API:

- Endpoint `https://trainss.market.alicloudapi.com/fapigw/train/query`, `Authorization: APPCODE …`, query params `search_type=1` (station names), `departure_station`, `arrival_station`, `date`, `enable_booking=2` (all trains).
- Dates must be within the 12306 pre-sale window (today .. today+14); the date picker is constrained accordingly.
- Seat availability comes from `prices[].num` keyed by `seat_name` (商务座/特等座, 一等座, 二等座, 无座).

## Build & deploy

- **Build:** `npm run build` → static files in `dist/`
- **Preview:** `npm run preview` to serve the built app locally.

Pushing to `main` deploys to Vercel via the GitHub Action in `.github/workflows/deploy-vercel.yml`. No server or environment variables are required; each user uses their own API key in the app.
