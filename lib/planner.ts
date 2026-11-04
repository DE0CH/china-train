// Route planner over the national timetable (public/timetable.json, built by crawler/ from 12306).
//
// It finds every direct train and every one-transfer pair between two stations, then keeps the
// options worth showing: those no other option beats on both departure and arrival (a later or
// equal departure that arrives earlier or at the same time, with no more transfers). Transfers
// are at the same station, or at another station of the same city (福田 → 深圳北 by metro), which
// needs a longer change. Seats and whether a train really runs on the day come from 12306 live
// (/api/query) afterwards: the timetable is a weekly snapshot of a weekday and a weekend day.

export type Station = { code: string; name: string; pinyin: string; abbr: string; city: string };

export interface Timetable {
  generated: string;
  stations: Station[];
  // per train: code, 12306 train_no, stops as [station index, arrive, depart] minutes
  trains: { code: string; no: string; stops: Int32Array }[];
  byStation: Map<number, Array<[number, number]>>; // station → [train, stop position]
  byCode: Map<string, number>;
  byCity: Map<string, number[]>;
}

export async function loadTimetable(): Promise<Timetable> {
  const r = await fetch("/timetable.json");
  if (!r.ok) throw new Error(`时刻表加载失败（HTTP ${r.status}）`);
  const raw = (await r.json()) as { generated: string; stations: string[][]; trains: [string, string, number[]][] };
  const stations = raw.stations.map(([code, name, pinyin, abbr, city]) => ({ code, name, pinyin, abbr, city }));
  const trains = raw.trains.map(([code, no, flat]) => ({ code, no, stops: Int32Array.from(flat) }));
  const byStation = new Map<number, Array<[number, number]>>();
  trains.forEach((t, ti) => {
    for (let p = 0; p < t.stops.length / 3; p++) {
      const s = t.stops[p * 3];
      let l = byStation.get(s);
      if (!l) byStation.set(s, (l = []));
      l.push([ti, p]);
    }
  });
  const byCode = new Map(stations.map((s, i) => [s.code, i]));
  const byCity = new Map<string, number[]>();
  stations.forEach((s, i) => { if (byStation.has(i)) { const l = byCity.get(s.city) ?? []; l.push(i); byCity.set(s.city, l); } });
  return { generated: raw.generated, stations, trains, byStation, byCode, byCity };
}

export interface Leg {
  train: string; trainNo: string;
  from: number; to: number;          // station indices
  depart: number; arrive: number;    // minutes from midnight of the travel date (may pass 1440)
}
export interface Route { legs: Leg[]; depart: number; arrive: number; transfers: number }

export interface PlanOptions {
  sameStationChange: number;   // minimum minutes to change trains in one station
  crossTownChange: number;     // minimum minutes to change between two stations of one city
  maxWait: number;             // longest wait for the second train
  sameCityEnds: boolean;       // also start/end at the other stations of the chosen cities
}
export const DEFAULT_OPTIONS: PlanOptions = { sameStationChange: 15, crossTownChange: 60, maxWait: 240, sameCityEnds: false };

const at = (t: Int32Array, p: number) => ({ s: t[p * 3], arr: t[p * 3 + 1], dep: t[p * 3 + 2] });

export function plan(tt: Timetable, from: number, to: number, o: PlanOptions = DEFAULT_OPTIONS): Route[] {
  const ends = (i: number) => (o.sameCityEnds ? tt.byCity.get(tt.stations[i].city) ?? [i] : [i]);
  const origins = new Set(ends(from)), dests = new Set(ends(to));
  // train → its first stop position at a destination station
  const destPos = new Map<number, number>();
  for (const d of dests) for (const [ti, p] of tt.byStation.get(d) ?? []) if (!destPos.has(ti) || p < destPos.get(ti)!) destPos.set(ti, p);
  // station → the trains boarding there that go on to a destination: [train, position]
  const boardAt = new Map<number, Array<[number, number]>>();
  for (const [ti, dq] of destPos) for (let p = 0; p < dq; p++) {
    const s = tt.trains[ti].stops[p * 3];
    let l = boardAt.get(s);
    if (!l) boardAt.set(s, (l = []));
    l.push([ti, p]);
  }

  const routes: Route[] = [];
  for (const o0 of origins) for (const [t1, p1] of tt.byStation.get(o0) ?? []) {
    const T1 = tt.trains[t1].stops, a = at(T1, p1);
    const start = a.dep % 1440, shift = start - a.dep; // the train's own times → the travel day's clock
    const leg1 = (q: number): Leg => ({ train: tt.trains[t1].code, trainNo: tt.trains[t1].no, from: o0, to: T1[q * 3], depart: start, arrive: T1[q * 3 + 1] + shift });
    const n = T1.length / 3;
    // direct
    const dp = destPos.get(t1);
    if (dp !== undefined && dp > p1) {
      const l = leg1(dp);
      routes.push({ legs: [l], depart: l.depart, arrive: l.arrive, transfers: 0 });
      continue; // a direct train is never improved by leaving it for another one
    }
    // one transfer: get off at a later stop x, board at x or another station of x's city
    for (let q = p1 + 1; q < n; q++) {
      const x = T1[q * 3];
      if (dests.has(x) || origins.has(x)) continue;
      const l1 = leg1(q);
      for (const y of tt.byCity.get(tt.stations[x].city) ?? [x]) {
        const minChange = y === x ? o.sameStationChange : o.crossTownChange;
        for (const [t2, p2] of boardAt.get(y) ?? []) {
          const dq = destPos.get(t2)!;
          if (t2 === t1) continue;
          const T2 = tt.trains[t2].stops, b = at(T2, p2);
          // the first departure of t2 from y (it runs daily at the same clock time) after the change
          let dep2 = b.dep % 1440 + Math.floor(l1.arrive / 1440) * 1440;
          while (dep2 < l1.arrive + minChange) dep2 += 1440;
          if (dep2 - l1.arrive > o.maxWait) continue;
          const arr2 = T2[dq * 3 + 1] - b.dep + dep2;
          const l2: Leg = { train: tt.trains[t2].code, trainNo: tt.trains[t2].no, from: y, to: T2[dq * 3], depart: dep2, arrive: arr2 };
          routes.push({ legs: [l1, l2], depart: start, arrive: arr2, transfers: 1 });
        }
      }
    }
  }
  return pareto(routes);
}

// keep a route unless another departs no earlier, arrives no later, has no more transfers, and is
// strictly better on one of them; among equals the shortest wait wins
function pareto(rs: Route[]): Route[] {
  const wait = (r: Route) => (r.legs.length > 1 ? r.legs[1].depart - r.legs[0].arrive : 0);
  rs.sort((a, b) => a.arrive - b.arrive || b.depart - a.depart || a.transfers - b.transfers || wait(a) - wait(b));
  const kept: Route[] = [];
  for (const r of rs) {
    if (kept.some((k) => k.depart >= r.depart && k.arrive <= r.arrive && k.transfers <= r.transfers)) continue;
    kept.push(r);
  }
  return kept.sort((a, b) => a.depart - b.depart || a.arrive - b.arrive);
}

// station search for the pickers: name, full pinyin, initials or telecode
// Station search: exact and prefix matches on the name, initials, telecode and the Latin keys (pinyin and an English
// name: a trailing 北/南/东/西 read as north/south/east/west, so "Shenzhen North" finds 深圳北) first; then fuzzy
// ones: the typed characters in order with gaps (深北 → 深圳北, szhbei → shenzhenbei), then a key with a typo or two
// (shenzen → shenzhen: 1 edit from 4 letters, 2 from 7, counted against the key's best prefix). Spaces and a final
// "station" are ignored. Within a tier, closer matches first, then busier stations. lib/ is ported to Swift in
// DE0CH/china-train-ios: keep the two identical.
const DIRECTION: Record<string, [string, string]> = { 北: ["bei", "north"], 南: ["nan", "south"], 东: ["dong", "east"], 西: ["xi", "west"] };
// 12306's own pinyin is not pinyin for these
const EXTRA_KEYS: Record<string, string[]> = { 香港西九龙: ["xianggangxijiulong", "hongkongwestkowloon", "westkowloon", "xijiulong"] };

function latinKeys(st: { name: string; pinyin: string }): string[] {
  const keys = [st.pinyin, ...(EXTRA_KEYS[st.name] ?? [])];
  const dir = DIRECTION[st.name.slice(-1)];
  if (dir && st.name.length >= 3 && st.pinyin.endsWith(dir[0])) keys.push(st.pinyin.slice(0, -dir[0].length) + dir[1]);
  return keys;
}

// q's characters found in s in order (each at the first place it can go): how many gaps they leave between them, or
// -1 when they are not all there
function gapsInOrder(q: string, s: string): number {
  let j = 0, gaps = 0, last = -1;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) { if (last >= 0 && i > last + 1) gaps++; last = i; j++; }
  return j === q.length ? gaps : -1;
}
// edits to turn q into some prefix of s (Levenshtein with a free tail of s)
function prefixEdits(q: string, s: string): number {
  let prev = Array.from({ length: s.length + 1 }, (_, j) => j);
  for (let i = 1; i <= q.length; i++) {
    const cur = [i];
    for (let j = 1; j <= s.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (q[i - 1] === s[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev);
}

export function searchStations(tt: Timetable, q: string, limit = 8): number[] {
  const t = q.trim();
  let s = t.toLowerCase().replace(/\s+/g, "");
  if (/^[a-z]+$/.test(s) && s.length > 7) s = s.replace(/(railway)?station$/, "");
  if (!s) return [];
  const latin = /^[a-z]+$/.test(s);
  const typos = !latin || s.length < 4 ? 0 : s.length < 7 ? 1 : 2;
  const scored: Array<[number, number]> = [];
  tt.stations.forEach((st, i) => {
    if (!tt.byStation.has(i)) return; // no passenger trains
    const keys = latin ? latinKeys(st) : [];
    let score = -1, near = 0;
    if (st.name === t) score = 0;
    else if (st.name.startsWith(t)) score = 1;
    else if (st.abbr === s || keys.includes(s)) score = 2;
    else if (st.abbr.startsWith(s) || keys.some((k) => k.startsWith(s))) score = 3;
    else if (st.code.toLowerCase() === s) score = 3;
    else if (st.name.includes(t) || st.city.startsWith(t)) score = 4;
    else if (s.length >= 2) {
      // in order with gaps: Chinese against the name, Latin against each key (its first letter typed first)
      const gaps = (latin ? keys.filter((k) => k[0] === s[0]) : [st.name]).map((k) => gapsInOrder(s, k)).filter((g) => g >= 0);
      if (gaps.length) { score = 5; near = Math.min(...gaps); }
      else if (typos) {
        const d = Math.min(...keys.map((k) => prefixEdits(s, k)));
        if (d <= typos) { score = 6; near = d; }
      }
    }
    if (score >= 0) scored.push([score * 100000 + Math.min(near, 9) * 10000 - Math.min(tt.byStation.get(i)?.length ?? 0, 9999), i]);
  });
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, i]) => i);
}

export const clock = (m: number) => {
  const d = Math.floor(m / 1440), r = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}${d > 0 ? ` +${d}` : ""}`;
};
export const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ""}` : `${m}分`);
