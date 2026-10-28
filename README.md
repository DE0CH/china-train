# china-train

Train route planner for mainland China and Hong Kong at **https://train.deyaochen.com**: pick any two
stations (autocomplete on name, pinyin or initials) and a date; it lists every direct train and every
one-transfer route worth taking, with live seats from **12306** (China Railway's official site). No
API key, no daily quota.

## How it works

- **Timetable** — `crawler/` (Rust) builds `public/timetable.json`: every station (12306's
  `station_name.js`) and every train with its stops and times. The train list comes from
  `search.12306.cn/search/v1/train/search` (≤200 results per keyword, so train-number prefixes are
  split digit by digit; it blocks an IP with HTTP 403 after a burst, hence the slow pace and
  backoff); each train's stops from `kyfw.12306.cn/otn/queryTrainInfo/query`. Two dates (a weekday
  and a weekend day) are crawled so weekend-only trains are in. 12306's own transfer planner
  (`lcquery`) is not used: it answers 没有查询到中转方案 for every route touching 香港西九龙.
- **Planner** — `lib/planner.ts`, in the browser: direct trains plus one transfer, at the same
  station or at another station of the same city (e.g. 福田 → 深圳北), keeping only routes no other
  route beats on both departure and arrival. Minimum change times and the longest wait are settings
  on the page (defaults: 15 min in one station, 60 min across town, wait ≤ 4 h).
- **Live seats** — `worker/index.ts`, a Cloudflare Worker, answers
  `GET /api/query?from=深圳坪山&to=深圳北&date=YYYY-MM-DD` → `{trains:[…]}` with the JSON endpoint
  12306's own search page uses (`kyfw.12306.cn/otn/leftTicket/query<X>`): it discovers the current
  path suffix and cookies from the search page, maps names to telecodes, parses the pipe-delimited
  rows (train_no @2, code @3, from/to telecodes @6/7, times @8/9, 商务座 @32, 一等座 @31, 二等座 @30,
  无座 @26) and keeps only rows whose boarding and alighting stations are the queried ones (12306
  also returns the rest of the city: 深圳北→香港西九龙 lists 福田 departures too). The page asks it for
  each leg; a train missing from the answer does not run that day and its routes are hidden.
  12306 is reached directly from Cloudflare's network (no proxy).
- **Hosting** — one Worker with Workers Static Assets (`wrangler.jsonc`): the built page and
  `timetable.json` are served from Cloudflare's edge without running code; only `/api/*` runs the
  Worker. Route `train.deyaochen.com/*`; no workers.dev or preview hostnames.

## Access guard

`train.deyaochen.com` has a Cloudflare Access application (policy: the owner's email; the Claude
agent's service token). `/api/*` also verifies the `Cf-Access-Jwt-Assertion` JWT (or the
`CF_Authorization` cookie) against the team's keys and the app's AUD (`CF_ACCESS_TEAM_DOMAIN`,
`CF_ACCESS_AUD` in `wrangler.jsonc`).

## Deploy

`.github/workflows/deploy.yml`: every push to `main` builds and runs `wrangler deploy`; every Monday
03:17 Beijing time it crawls the timetable again (a push reuses the cached copy while it is under
7 days old; *Run workflow* with *recrawl* forces one). Secret: `CLOUDFLARE_API_TOKEN` (token
`china-train-ci`: Workers Scripts Write + Account Settings Read, Workers Routes Write + Zone Read
on deyaochen.com).

## Develop

```bash
npm install
cargo run --release --manifest-path crawler/Cargo.toml -- public/timetable.json --seed crawler/seed-trains.json   # ~10 min
npm run dev        # the page; /api needs `npx wrangler dev` (run `npm run build` first)
npm run lint       # tsc for the page and the Worker
npm run build      # dist/
```

Cross-border G trains show `无座 --`.
