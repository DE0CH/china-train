// Live seats from 12306 through the Worker (worker/index.ts): one /api/query per station pair and
// date. A train missing from the answer does not run that day (the planner's timetable is a weekly
// snapshot), so the page drops routes that use it.

export interface Seats { sw: string; yd: string; ed: string; wz: string; canBuy: boolean; code: string }

interface QueryTrain {
  trainno: string; train_no: string; from: string; to: string;
  departuretime: string; arrivaltime: string; canBuy: boolean;
  numsw: string; numyd: string; numed: string; numwz: string;
}

const cache = new Map<string, Promise<Map<string, Seats>>>();

export function seatsFor(fromCode: string, toCode: string, date: string): Promise<Map<string, Seats>> {
  const key = `${fromCode}|${toCode}|${date}`;
  let p = cache.get(key);
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
      return new Map((data.trains || []).map((t) => [t.train_no, { sw: t.numsw, yd: t.numyd, ed: t.numed, wz: t.numwz, canBuy: t.canBuy, code: t.trainno }]));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
