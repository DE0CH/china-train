// Cloudflare Worker: the page's static files are Workers Static Assets (dist/, served from the
// edge without running this code); only /api/* reaches this Worker, which queries 12306 (China
// Railway's official ticketing site) for the trains between two stations on a date.
//
//   GET /api/query?from=深圳坪山&to=深圳北&date=2026-09-17
//   -> { trains: [{ trainno, train_no, from, to, departuretime, arrivaltime, duration, origin, terminus,
//                   start, canBuy, numsw, numyd, numed, numwz }], path }
//   GET /api/runs?train=G6517&start=20261104       (the date it leaves its origin)
//   -> { runs: true }   whether the train runs that day: 12306 lists its stops
//   GET /api/gate?train=G6517&date=2026-11-04&station=IOQ&start=20261104   (the dates it leaves that station / its origin)
//   -> { gate: "检票口11B" }   its 检票口 there as 12306 writes it: from its own 检票口 query, else (often the case at
//      smaller stations, and only for trains running today) the stops its WeChat mini-program lists; "" when neither
//
// 12306 has no public API; this calls the JSON endpoint its own search page uses
// (kyfw.12306.cn/otn/leftTicket/query<X>). Requirements learned the hard way:
//   - the path suffix (query / queryZ / queryA / queryG …) changes a few times a year; it is
//     discovered from the search page (`var CLeftTicketUrl = 'leftTicket/queryG'`), not hard-coded
//   - the endpoint wants cookies from a prior visit to the search page, a browser User-Agent
//     and a Referer, or it answers with an HTML redirect instead of JSON
//   - station names map to 3-letter telecodes via the site's static station_name.js
//   - rows come back as pipe-delimited strings with fields at fixed positions (see FIELD)
import { STATION_SNAPSHOT } from "../lib/station-snapshot.js";

const BASE = "https://kyfw.12306.cn";
const INIT_URL = `${BASE}/otn/leftTicket/init`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// positions in a result row (12306 does not document them; the community-maintained list is
// the one used by 12306-mcp and every open-source 12306 client)
const FIELD = {
  trainId: 2, trainNo: 3, originCode: 4, terminusCode: 5, fromCode: 6, toCode: 7, depart: 8, arrive: 9, duration: 10,
  canWebBuy: 11, startDate: 13, tz: 25, wz: 26, ze: 30, zy: 31, swz: 32,
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function get(url: string, headers: Record<string, string> = {}, timeoutMs = 20000) {
  return fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", ...headers },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// ---- station names -> telecodes (cached per isolate) ----------------------------------
let stationsPromise: Promise<Map<string, string>> | null = null;
const codeToName = new Map<string, string>();
function stations(): Promise<Map<string, string>> {
  if (!stationsPromise) {
    stationsPromise = (async () => {
      // the live list; the bundled snapshot when 12306's static file can't be had
      let js = "";
      try { js = await (await get(`${BASE}/otn/resources/js/framework/station_name.js`, {}, 10000)).text(); }
      catch (e: any) { console.error(`station list: fetch failed (${e.message}), using the snapshot`); }
      if (!js.includes("station_names")) js = STATION_SNAPSHOT.split("@").map((p) => `@x|${p}|`).join("");
      const map = new Map<string, string>();
      // entries look like @bjb|北京北|VAP|beijingbei|bjb|0|0357|北京|||
      for (const m of js.matchAll(/@[a-z0-9]*\|([^|]+)\|([A-Z]{3})\|/g)) { const name = m[1].replace(/\s+/g, ""); map.set(name, m[2]); codeToName.set(m[2], name); }
      if (map.size < 100) throw new Error("station list looked wrong");
      return map;
    })().catch((e) => { stationsPromise = null; throw e; });
  }
  return stationsPromise;
}

// ---- search-page visit: cookies + the current query path (cached briefly) ------------
type Session = { cookie: string; path: string; at: number };
let session: Session | null = null;
async function openSession(): Promise<Session> {
  const r = await get(INIT_URL);
  const html = await r.text();
  const m = html.match(/var CLeftTicketUrl\s*=\s*'([^']+)'/);
  const path = m ? m[1] : "leftTicket/query";
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { cookie, path, at: Date.now() };
}

async function query(from: string, to: string, date: string) {
  if (!session || Date.now() - session.at > 8 * 60 * 1000) session = await openSession();
  const qs = new URLSearchParams({ "leftTicketDTO.train_date": date, "leftTicketDTO.from_station": from, "leftTicketDTO.to_station": to, purpose_codes: "ADULT" });
  const r = await get(`${BASE}/otn/${session.path}?${qs}`, { Cookie: session.cookie, Referer: INIT_URL, Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", "If-Modified-Since": "0", "Cache-Control": "no-cache" });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { session = null; throw new Error(`12306 answered ${r.status} with non-JSON (${text.slice(0, 60).replace(/\s+/g, " ")})`); }
  if (!data || data.httpstatus !== 200 || !data.data) { session = null; throw new Error(`12306 error: ${(data && (data.messages || []).join("; ")) || "empty response"}`); }
  return data.data as { result: string[]; map: Record<string, string> };
}

// 12306 answers with every station in the queried cities (深圳北→香港西九龙 also lists 福田 and 深圳
// departures), so keep only rows whose boarding and alighting stations are the ones asked for
function parseRows(rows: string[], names: Record<string, string>, fromCode: string, toCode: string) {
  return rows.map((row) => row.split("|")).filter((f) => f[FIELD.fromCode] === fromCode && f[FIELD.toCode] === toCode).map((f) => {
    const seat = (i: number) => (f[i] ?? "").trim() || "--";
    // 12306's inline map only covers the queried stations; origin/terminus need the full list
    const name = (code: string) => names[code] || codeToName.get(code) || code;
    return {
      trainno: f[FIELD.trainNo] || "", train_no: f[FIELD.trainId] || "",
      from: name(f[FIELD.fromCode]), to: name(f[FIELD.toCode]),
      departuretime: f[FIELD.depart] || "", arrivaltime: f[FIELD.arrive] || "", duration: f[FIELD.duration] || "",
      origin: name(f[FIELD.originCode]), terminus: name(f[FIELD.terminusCode]),
      // the date the train left its origin (YYYYMMDD), which /api/gates needs
      start: f[FIELD.startDate] || "",
      canBuy: f[FIELD.canWebBuy] === "Y",
      // 商务座 falls back to 特等座 (older sets label the top class that way)
      numsw: seat(FIELD.swz) !== "--" ? seat(FIELD.swz) : seat(FIELD.tz),
      numyd: seat(FIELD.zy), numed: seat(FIELD.ze), numwz: seat(FIELD.wz),
    };
  });
}

async function handleQuery(url: URL): Promise<Response> {
  const from = (url.searchParams.get("from") || "").trim(), to = (url.searchParams.get("to") || "").trim(), date = (url.searchParams.get("date") || "").trim();
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "from, to and date=YYYY-MM-DD are required" }, 400);
  let map: Map<string, string>;
  try { map = await stations(); } catch (e: any) { return json({ error: `车站列表获取失败：${e.message}` }, 502); }
  const fromCode = /^[A-Z]{3}$/.test(from) ? from : map.get(from), toCode = /^[A-Z]{3}$/.test(to) ? to : map.get(to);
  if (!fromCode) return json({ error: `站名无效：「${from}」不存在` }, 404);
  if (!toCode) return json({ error: `站名无效：「${to}」不存在` }, 404);
  // one retry with a fresh search-page session (a failure clears it)
  const errors: string[] = [];
  for (let i = 0; i < 2; i++) {
    try {
      const data = await query(fromCode, toCode, date);
      return json({ trains: parseRows(data.result || [], data.map || {}, fromCode, toCode), path: session?.path });
    } catch (e: any) { errors.push(e.message); }
  }
  console.error(`12306 query failed ${fromCode}->${toCode} ${date}: ${errors.join(" | ")}`);
  return json({ error: `12306 查询失败（${errors.join(" | ")}）` }, 502);
}

// ---- a train's stops on a day as 12306's WeChat mini-program shows them (mobile.12306.cn, no login) ---------------
// Empty when the train does not run that day; each stop's `wicket` (检票口) is filled in for trains running today.
async function stopsOf(train: string, start: string): Promise<any[]> {
  const r = await fetch("https://mobile.12306.cn/wxxcx/wechat/main/travelServiceQrcodeTrainInfo", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ trainCode: train, startDay: start, startTime: "", endDay: "", endTime: "" }),
    signal: AbortSignal.timeout(15000),
  });
  const data: any = await r.json();
  if (!data?.data) throw new Error(`HTTP ${r.status}`);
  return data.data.trainDetail?.stopTime || [];
}

async function handleRuns(url: URL): Promise<Response> {
  const train = (url.searchParams.get("train") || "").trim().toUpperCase(), start = (url.searchParams.get("start") || "").trim();
  if (!/^[A-Z0-9]{1,8}$/.test(train) || !/^\d{8}$/.test(start)) return json({ error: "train and start=YYYYMMDD are required" }, 400);
  try {
    return json({ runs: (await stopsOf(train, start)).length > 0 });
  } catch (e: any) {
    return json({ error: `开行查询失败（${e.message}）` }, 502);
  }
}

// ---- 检票口: 12306's own 检票口 query (www.12306.cn 信息查询 → 检票口): one train at one station on one date --------
// Its field is called trainPlatform but holds the 检票口 ("检票口11B"); it is known days ahead. No platform is given.
async function handleGate(url: URL): Promise<Response> {
  const train = (url.searchParams.get("train") || "").trim().toUpperCase(), date = (url.searchParams.get("date") || "").trim();
  const station = (url.searchParams.get("station") || "").trim().toUpperCase(), start = (url.searchParams.get("start") || "").trim();
  if (!/^[A-Z0-9]{1,8}$/.test(train) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(station) || !/^\d{8}$/.test(start))
    return json({ error: "train, date=YYYY-MM-DD, station (telecode) and start=YYYYMMDD are required" }, 400);
  try {
    const r = await fetch("https://www.12306.cn/index/otn/index12306/queryTicketCheck", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: "https://www.12306.cn/index/view/infos/ticket_check.html" },
      body: new URLSearchParams({ trainDate: date, station_train_code: train, from_station_telecode: station }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await r.json();
    if (!data?.data) throw new Error(`HTTP ${r.status}`);
    const gate = String(data.data.trainPlatform ?? "").trim();
    if (gate) return json({ gate });
    const stop = (await stopsOf(train, start)).find((s) => s.stationTelecode === station);
    const w = String(stop?.wicket ?? "").trim();
    return json({ gate: w && !/^-+$/.test(w) ? w : "" });
  } catch (e: any) {
    return json({ error: `检票口查询失败（${e.message}）` }, 502);
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/query") return handleQuery(url);
    if (url.pathname === "/api/runs") return handleRuns(url);
    if (url.pathname === "/api/gate") return handleGate(url);
    return json({ error: "not found" }, 404);
  },
};
