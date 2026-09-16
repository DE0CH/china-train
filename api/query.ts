// Vercel serverless function: query 12306 (China Railway's official ticketing site) for the
// trains between two stations on a date, and return them in the shape the app renders.
//
//   GET /api/query?from=深圳坪山&to=深圳北&date=2026-09-17
//   -> { trains: [{ trainno, from, to, departuretime, arrivaltime, duration, origin, terminus,
//                   canBuy, numsw, numyd, numed, numwz }], path, via }
//
// 12306 has no public API; this calls the JSON endpoint its own search page uses
// (kyfw.12306.cn/otn/leftTicket/query<X>). Requirements learned the hard way:
//   - the path suffix (query / queryZ / queryA / queryG …) changes a few times a year; it is
//     discovered from the search page (`var CLeftTicketUrl = 'leftTicket/queryG'`), not hard-coded
//   - the endpoint wants cookies from a prior visit to the search page, a browser User-Agent
//     and a Referer, or it answers with an HTML redirect instead of JSON
//   - station names map to 3-letter telecodes via the site's static station_name.js
//   - rows come back as pipe-delimited strings with fields at fixed positions (see FIELD)
// Egress goes through PROXY_URL (an IPRoyal proxy, http://user:pass@host:port) when set —
// 12306 is happier with a Chinese mobile/residential exit than with a US datacenter IP — and
// falls back to a direct request if the proxy fails. Static files (station list) are fetched
// directly to save proxy traffic.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

const BASE = "https://kyfw.12306.cn";
const INIT_URL = `${BASE}/otn/leftTicket/init`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// positions in a result row (12306 does not document them; the community-maintained list is
// the one used by 12306-mcp and every open-source 12306 client)
const FIELD = {
  trainNo: 3, originCode: 4, terminusCode: 5, fromCode: 6, toCode: 7, depart: 8, arrive: 9, duration: 10,
  canWebBuy: 11, startDate: 13, tz: 25, wz: 26, ze: 30, zy: 31, swz: 32,
} as const;

let dispatcher: Dispatcher | null | undefined;
function proxyDispatcher(): Dispatcher | null {
  if (dispatcher !== undefined) return dispatcher;
  const url = process.env.PROXY_URL;
  dispatcher = url ? new ProxyAgent({ uri: url, requestTls: { rejectUnauthorized: true } }) : null;
  return dispatcher;
}

async function get(url: string, opts: { headers?: Record<string, string>; proxy: boolean; timeoutMs?: number }) {
  const d = opts.proxy ? proxyDispatcher() : null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    return await undiciFetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", ...(opts.headers || {}) },
      redirect: "manual",
      signal: ctrl.signal,
      ...(d ? { dispatcher: d } : {}),
    });
  } finally { clearTimeout(t); }
}

// ---- station names -> telecodes (cached per instance) --------------------------------
let stationsPromise: Promise<Map<string, string>> | null = null;
const codeToName = new Map<string, string>();
async function stations(): Promise<Map<string, string>> {
  if (!stationsPromise) {
    stationsPromise = (async () => {
      const r = await get(`${BASE}/otn/resources/js/framework/station_name.js`, { proxy: false, timeoutMs: 25000 })
        .catch(() => get(`${BASE}/otn/resources/js/framework/station_name.js`, { proxy: true, timeoutMs: 25000 }));
      const js = await r.text();
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
type Session = { cookie: string; path: string; via: "proxy" | "direct"; at: number };
let session: Session | null = null;
async function openSession(proxy: boolean): Promise<Session> {
  const r = await get(INIT_URL, { proxy });
  const html = await r.text();
  const m = html.match(/var CLeftTicketUrl\s*=\s*'([^']+)'/);
  const path = m ? m[1] : "leftTicket/query";
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, path, via: proxy ? "proxy" : "direct", at: Date.now() };
}

async function query(from: string, to: string, date: string, proxy: boolean) {
  if (!session || session.via !== (proxy ? "proxy" : "direct") || Date.now() - session.at > 10 * 60 * 1000) session = await openSession(proxy);
  const qs = new URLSearchParams({ "leftTicketDTO.train_date": date, "leftTicketDTO.from_station": from, "leftTicketDTO.to_station": to, purpose_codes: "ADULT" });
  const url = `${BASE}/otn/${session.path}?${qs}`;
  const r = await get(url, { proxy, headers: { Cookie: session.cookie, Referer: INIT_URL, Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", "If-Modified-Since": "0", "Cache-Control": "no-cache" } });
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch { session = null; throw new Error(`12306 answered ${r.status} with non-JSON (${text.slice(0, 60).replace(/\s+/g, " ")})`); }
  if (!data || data.httpstatus !== 200 || !data.data) { session = null; throw new Error(`12306 error: ${(data && (data.messages || []).join("; ")) || "empty response"}`); }
  return data.data as { result: string[]; map: Record<string, string> };
}

function parseRows(rows: string[], names: Record<string, string>) {
  return rows.map((row) => {
    const f = row.split("|");
    const seat = (i: number) => (f[i] ?? "").trim() || "--";
    // 12306's inline map only covers the queried stations; origin/terminus need the full list
    const name = (code: string) => names[code] || codeToName.get(code) || code;
    return {
      trainno: f[FIELD.trainNo] || "",
      from: name(f[FIELD.fromCode]), to: name(f[FIELD.toCode]),
      departuretime: f[FIELD.depart] || "", arrivaltime: f[FIELD.arrive] || "", duration: f[FIELD.duration] || "",
      origin: name(f[FIELD.originCode]), terminus: name(f[FIELD.terminusCode]),
      canBuy: f[FIELD.canWebBuy] === "Y",
      // 商务座 falls back to 特等座 (older sets label the top class that way)
      numsw: seat(FIELD.swz) !== "--" ? seat(FIELD.swz) : seat(FIELD.tz),
      numyd: seat(FIELD.zy), numed: seat(FIELD.ze), numwz: seat(FIELD.wz),
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const from = String(req.query.from || "").trim(), to = String(req.query.to || "").trim(), date = String(req.query.date || "").trim();
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "from, to and date=YYYY-MM-DD are required" });
  let map: Map<string, string>;
  try { map = await stations(); } catch (e: any) { return res.status(502).json({ error: `车站列表获取失败：${e.message}` }); }
  const fromCode = /^[A-Z]{3}$/.test(from) ? from : map.get(from), toCode = /^[A-Z]{3}$/.test(to) ? to : map.get(to);
  if (!fromCode) return res.status(404).json({ error: `站名无效：「${from}」不存在` });
  if (!toCode) return res.status(404).json({ error: `站名无效：「${to}」不存在` });

  const attempts: Array<{ proxy: boolean }> = process.env.PROXY_URL ? [{ proxy: true }, { proxy: true }, { proxy: false }] : [{ proxy: false }, { proxy: false }];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const data = await query(fromCode, toCode, date, a.proxy);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ trains: parseRows(data.result || [], data.map || {}), via: a.proxy ? "proxy" : "direct", path: session?.path });
    } catch (e: any) { errors.push(`${a.proxy ? "proxy" : "direct"}: ${e.message}`); }
  }
  return res.status(502).json({ error: `12306 查询失败（${errors.join(" | ")}）` });
}
