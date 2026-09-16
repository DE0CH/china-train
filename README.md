# china-train

Train ticket search for **Hong Kong ↔ Ping Shan** (via Shenzhen North): a Vite/React page plus one
Vercel serverless function that queries **12306** (China Railway's official site) directly and
computes the transfer options. No API key, no daily quota.

## How it works

- `api/query.ts` — `GET /api/query?from=深圳坪山&to=深圳北&date=YYYY-MM-DD` → `{trains:[…]}`.
  It calls the JSON endpoint 12306's own search page uses (`kyfw.12306.cn/otn/leftTicket/query<X>`):
  discovers the current path suffix from the search page, takes the cookies that page sets, maps
  station names to telecodes via 12306's `station_name.js`, and parses the pipe-delimited rows
  (train no @3, from/to codes @6/7, times @8/9, 商务座 @32, 一等座 @31, 二等座 @30, 无座 @26).
  Egress goes through `PROXY_URL` (an IPRoyal proxy, `http://user:pass@host:port`, Vercel env var)
  when set, with a direct fallback; static files are fetched directly. Region pinned to `hkg1`.
- `lib/train-api.ts` — calls the function for both legs and pairs them with the minimum transfer
  time; `src/App.tsx` renders the cards.

## Access guard

The site is used at **https://train.deyaochen.com** — a Cloudflare-proxied hostname with a
Cloudflare Access application (policy: the owner's email; the Claude agent's service token). Every
request is checked by `middleware.ts` (Vercel Edge Middleware): it verifies the `Cf-Access-Jwt-Assertion`
JWT against the team's keys and the app's AUD, so the bare `china-train.vercel.app` hostname (which
bypasses Cloudflare) can't be used to query 12306 and spend proxy traffic — pages are redirected to
the guarded host, `/api/*` gets 401.

## Secrets

GitHub Actions secrets are the source of truth (`PROXY_URL`, `IPROYAL_API`, `IPROYAL_SUBUSER_HASH`);
the deploy workflow upserts them into the Vercel project env before each build, together with the
non-secret guard settings (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `PUBLIC_HOST`). Rotate a secret
by updating it in GitHub and re-running the workflow. `/api/proxy-status` reports the residential
sub-user's remaining traffic and the page shows it inline (yellow under 30 MB, red when exhausted,
and a notice when a query had to bypass the proxy). No `alert()`-style popups anywhere.

## Develop

```bash
npm install
npm run dev        # UI only; the function needs `vercel dev` or the deployed site
npm run lint       # tsc
npm run build      # dist/
```

Pushing to `main` deploys to Vercel via `.github/workflows/deploy-vercel.yml`.

Notes: 12306 returns same-city stations too (a 深圳北→香港西九龙 query also lists 福田 departures);
the app keeps only exact from/to matches. Cross-border G trains show `无座 --`.
