// Live seats from 12306 through the Worker (worker/index.ts): one /api/query per station pair and
// date. A train missing from the answer does not run that day (the planner's timetable is a weekly
// snapshot), so the page drops routes that use it.

export interface Seats { sw: string; yd: string; ed: string; wz: string; canBuy: boolean; code: string; terminus: string; start: string }

interface QueryTrain {
  trainno: string; train_no: string; from: string; to: string;
  departuretime: string; arrivaltime: string; terminus: string; start: string; canBuy: boolean;
  numsw: string; numyd: string; numed: string; numwz: string;
}

const cache = new Map<string, Promise<Map<string, Seats>>>();

// `fresh` skips the answer cached in this page and asks 12306 again (the refresh button).
export function seatsFor(fromCode: string, toCode: string, date: string, fresh = false): Promise<Map<string, Seats>> {
  const key = `${fromCode}|${toCode}|${date}`;
  let p = fresh ? undefined : cache.get(key);
  if (!p) {
    p = (async () => {
      const url = new URL("/api/query", window.location.origin);
      url.searchParams.set("from", fromCode);
      url.searchParams.set("to", toCode);
      url.searchParams.set("date", date);
      let res: Response;
      try { res = await fetch(url); } catch { throw new Error("网络请求失败，请检查网络连接后重试"); }
      let data: { trains?: QueryTrain[]; error?: string };
      try { data = await res.json(); } catch { throw new Error(`服务器返回了非预期的响应（HTTP ${res.status}）`); }
      if (!res.ok || data.error) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
      return new Map((data.trains || []).map((t) => [t.train_no, { sw: t.numsw, yd: t.numyd, ed: t.numed, wz: t.numwz, canBuy: t.canBuy, code: t.trainno, terminus: t.terminus || "", start: t.start || "" }]));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

// Six side queries at a time (a train's run, a 检票口): each waits for a slot, and `wanted` is asked when its turn
// comes: false (the page moved to another date) skips it.
let slots = 6;
const waiting: Array<() => void> = [];
async function inTurn<T>(wanted: () => boolean, run: () => Promise<T>): Promise<T | null> {
  if (slots > 0) slots--; else await new Promise<void>((r) => waiting.push(r));
  try { return wanted() ? await run() : null; }
  finally { const next = waiting.shift(); if (next) next(); else slots++; }
}
function cached<T>(cache: Map<string, Promise<T | null>>, key: string, make: () => Promise<T | null>): Promise<T | null> {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
    p.then((v) => { if (v === null) cache.delete(key); }, () => cache.delete(key));
  }
  return p;
}

// Whether a train runs on a day (its code and origin date YYYYMMDD), from 12306's list of its stops; null when
// skipped, `runs` null when 12306 could not be asked.
export interface TrainDay { runs: boolean | null }
const runCache = new Map<string, Promise<TrainDay | null>>();
export function trainDay(code: string, start: string, wanted: () => boolean = () => true): Promise<TrainDay | null> {
  return cached(runCache, `${code}|${start}`, () => inTurn(wanted, async () => {
    try {
      const url = new URL("/api/runs", window.location.origin);
      url.searchParams.set("train", code);
      url.searchParams.set("start", start);
      const res = await fetch(url);
      const data: { runs?: boolean } = await res.json();
      if (!res.ok || typeof data.runs !== "boolean") throw new Error();
      return { runs: data.runs };
    } catch { return { runs: null }; }
  }));
}

// 12306's 检票口 for a train boarding at a station on a date (its own 检票口 query: one gate, known days ahead), as
// 12306 writes it ("检票口11B"); "" when 12306 has none (or could not be asked); null when skipped.
const gateCache = new Map<string, Promise<string | null>>();
export function gateFor(code: string, date: string, station: string, start: string, wanted: () => boolean = () => true): Promise<string | null> {
  return cached(gateCache, `${code}|${date}|${station}`, () => inTurn(wanted, async () => {
    try {
      const url = new URL("/api/gate", window.location.origin);
      url.searchParams.set("train", code);
      url.searchParams.set("date", date);
      url.searchParams.set("station", station);
      url.searchParams.set("start", start);
      const res = await fetch(url);
      const data: { gate?: string } = await res.json();
      return res.ok && typeof data.gate === "string" ? data.gate : "";
    } catch { return ""; }   // a failure shows no 检票口 (asking again at once would loop)
  }));
}

// The short form of each station's 检票口 strings ("检票口10A、11A,10B、11B" -> "10/11"), researched in advance per
// station from 12306's own strings (public/gate-labels.json). Exact strings only: one not in it is shown as 12306
// writes it.
let labels: Promise<Record<string, Record<string, string>>> | null = null;
export function gateLabels(): Promise<Record<string, Record<string, string>>> {
  if (!labels) labels = fetch("/gate-labels.json").then((r) => (r.ok ? r.json() : {})).catch(() => { labels = null; return {}; });
  return labels;
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
