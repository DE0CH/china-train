# china-train

Train ticket search for **Hong Kong ↔ Ping Shan** (via Shenzhen North). Built with Next.js (React + TypeScript) for deployment on Vercel.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set your train API key:

   ```bash
   cp .env.example .env.local
   ```

   Add your Alibaba Cloud API Marketplace APPCODE as `API_KEY` (for [jisutrain API](https://jisutrain.market.alicloudapi.com)).

3. Run locally:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

1. Push the repo to GitHub and import the project in [Vercel](https://vercel.com).
2. In the project **Settings → Environment Variables**, add `API_KEY` with your APPCODE.
3. Deploy. The API route runs server-side so your key stays secret.