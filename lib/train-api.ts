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

// 检票口 by station telecode for one train (its code and origin date YYYYMMDD), a few queries at a time. Only a
// nice-to-have: a failure or a train 12306 has none for yet gives an empty map, and the page shows nothing.
// `wanted` is asked when the query's turn comes: false (the page moved to another date) skips it and gives null.
const gateCache = new Map<string, Promise<Map<string, string> | null>>();
let gateSlots = 3;
const gateQueue: Array<() => void> = [];
export function gatesFor(code: string, start: string, wanted: () => boolean = () => true): Promise<Map<string, string> | null> {
  const key = `${code}|${start}`;
  let p = gateCache.get(key);
  if (!p) {
    p = (async () => {
      if (gateSlots > 0) gateSlots--; else await new Promise<void>((r) => gateQueue.push(r));
      if (!wanted()) { gateCache.delete(key); const next = gateQueue.shift(); if (next) next(); else gateSlots++; return null; }
      try {
        const url = new URL("/api/gates", window.location.origin);
        url.searchParams.set("train", code);
        url.searchParams.set("start", start);
        const data: { gates?: Record<string, string> } = await (await fetch(url)).json();
        return new Map(Object.entries(data.gates || {}));
      } catch { gateCache.delete(key); return new Map<string, string>(); }
      finally { const next = gateQueue.shift(); if (next) next(); else gateSlots++; }
    })();
    gateCache.set(key, p);
  }
  return p;
}

// 12306's 检票口 text, shorter: "16检票口,17检票口" -> "16 / 17", "检票口1,检票口3" -> "1 / 3"; null when nothing is left
export function gateLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(/[,，]/).map((p) => p.trim().replace(/(进站)?检票口$/, "").replace(/^检票口/, "").trim()).filter((p) => p && !/^-+$/.test(p));
  return parts.length ? parts.join(" / ") : null;
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
