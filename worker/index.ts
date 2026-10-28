// Cloudflare Worker: the page's static files are Workers Static Assets (dist/, served from the
// edge without running this code); only /api/* reaches this Worker, which queries 12306 (China
// Railway's official ticketing site) for the trains between two stations on a date.
//
//   GET /api/query?from=深圳坪山&to=深圳北&date=2026-09-17
//   -> { trains: [{ trainno, train_no, from, to, departuretime, arrivaltime, duration, origin, terminus,
//                   canBuy, numsw, numyd, numed, numwz }], path }
//
// 12306 has no public API; this calls the JSON endpoint its own search page uses
// (kyfw.12306.cn/otn/leftTicket/query<X>). Requirements learned the hard way:
//   - the path suffix (query / queryZ / queryA / queryG …) changes a few times a year; it is
//     discovered from the search page (`var CLeftTicketUrl = 'leftTicket/queryG'`), not hard-coded
//   - the endpoint wants cookies from a prior visit to the search page, a browser User-Agent
//     and a Referer, or it answers with an HTML redirect instead of JSON
//   - station names map to 3-letter telecodes via the site's static station_name.js
//   - rows come back as pipe-delimited strings with fields at fixed positions (see FIELD)
//
// The hostname train.deyaochen.com sits behind a Cloudflare Access application; /api/* also
// verifies the Access JWT itself (vars CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD), so the API answers
// nothing that did not pass Access even if another route to the Worker appeared.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { STATION_SNAPSHOT } from "../lib/station-snapshot.js";

interface Env { CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string }

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

// ---- Cloudflare Access JWT ----------------------------------------------------------
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function accessOk(req: Request, env: Env): Promise<boolean> {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = req.headers.get("cf-access-jwt-assertion") || (m ? m[1] : null);
  if (!token) return false;
  jwks ??= createRemoteJWKSet(new URL(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  try { await jwtVerify(token, jwks, { issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`, audience: env.CF_ACCESS_AUD }); return true; } catch { return false; }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!(await accessOk(req, env))) return json({ error: "未授权：请通过 train.deyaochen.com 访问并登录 Cloudflare Access" }, 401);
    if (url.pathname === "/api/query") return handleQuery(url);
    return json({ error: "not found" }, 404);
  },
};
