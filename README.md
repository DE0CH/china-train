# china-train

Train ticket search for **Hong Kong ↔ Ping Shan** (via Shenzhen North). A client-only wrapper around the [jisutrain API](https://jisutrain.market.alicloudapi.com): you provide your own API key and the app calls the upstream API from your browser, then computes and displays transfer options.

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

3. Get an API key (APPCODE) from [Alibaba Cloud API Marketplace](https://market.aliyun.com/products/57126001/cmapi028426.html) and enter it in the app. It is stored only in your browser (localStorage). If the upstream API blocks browser requests (CORS), you may need to use a CORS proxy or run the app in an environment that allows it.

## Build & deploy

- **Build:** `npm run build` → static files in `dist/`
- **Preview:** `npm run preview` to serve the built app locally.

Deploy the `dist/` folder to any static host (Vercel, Netlify, GitHub Pages, etc.). No server or environment variables are required; each user uses their own API key in the app.
