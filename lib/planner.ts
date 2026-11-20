// Route planner over the national timetable (public/timetable.json, built by crawler/ from 12306).
//
// It finds the routes between two stations with any number of transfers and keeps the options worth showing: those
// no other option beats on departure, arrival and transfers (a later or equal departure that arrives earlier or at
// the same time, with no more transfers). Transfers are at the same station, or at another station of the same city
// (福田 → 深圳北 by metro), which needs a longer change. Seats and whether a train really runs on the day come from
// 12306 live (/api/query) afterwards: the timetable is a weekly snapshot of a weekday and a weekend day.
export type Station = { code: string; name: string; pinyin: string; abbr: string; city: string };

export interface Timetable {
  generated: string;
  stations: Station[];
  // per train: code, 12306 train_no, stops as [station index, arrive, depart] minutes
  trains: { code: string; no: string; stops: Int32Array }[];
  byStation: Map<number, Array<[number, number]>>; // station → [train, stop position]
  byCode: Map<string, number>;
  byCity: Map<string, number[]>;
  // for the planner, per station: the stations of its city that have trains (itself included), its departures by
  // clock time as [time of day, train, position] flat (a train's last stop left out), and the stops just before it on
  // every train as [station, least minutes riding from there] flat
  city: number[][];
  departures: Int32Array[];
  before: Int32Array[];
  first: Int32Array; // per train, the number of the stops of the trains before it (a stop's number: first[t] + position)
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
  const city = stations.map((s, i) => byCity.get(s.city) ?? [i]);
  const departures = stations.map((_, i) => {
    const d = (byStation.get(i) ?? []).filter(([t, p]) => p < trains[t].stops.length / 3 - 1).map(([t, p]) => [trains[t].stops[p * 3 + 2] % 1440, t, p]);
    return Int32Array.from(d.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).flat());
  });
  const least = stations.map(() => new Map<number, number>());
  for (const { stops: T } of trains) for (let p = 1; p < T.length / 3; p++) {
    // 12306 has a stop or two that arrive before the one before was left: counted as no time
    const m = least[T[p * 3]], r = T[p * 3 - 3], w = Math.max(0, T[p * 3 + 1] - T[p * 3 - 1]);
    if (!(m.get(r)! <= w)) m.set(r, w);
  }
  const before = least.map((m) => Int32Array.from([...m].flat()));
  const first = new Int32Array(trains.length);
  for (let t = 1; t < trains.length; t++) first[t] = first[t - 1] + trains[t - 1].stops.length / 3;
  return { generated: raw.generated, stations, trains, byStation, byCode, byCity, city, departures, before, first };
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
  maxWait: number;             // longest wait for the next train at a transfer
  sameCityEnds: boolean;       // also start/end at the other stations of the chosen cities
}
export const DEFAULT_OPTIONS: PlanOptions = { sameStationChange: 15, crossTownChange: 60, maxWait: 240, sameCityEnds: false };

// A search over "on train t, boarded at stop pos, on the day its times are shifted by `day` minutes, after k
// transfers", round k by round k, from each departure at the origin, latest first (trip-based routing over a daily
// timetable). What prunes it is also what makes it end, with no cap on transfers or days:
// - nothing is followed that cannot arrive by the arrival of a route already found with no more transfers (with a
//   lower bound: the least riding time from there to the destination);
// - a state is dropped when the same train was already boarded at that stop or an earlier one, on the same day or an
//   earlier one (trains run daily: the earlier day's ride does everything this one does, sooner), with no more
//   transfers, from a departure no earlier (an earlier round, or a later departure searched before);
// - for the same reason a change is not offered the trains a change at that station already was: those leaving at
//   times an earlier change there with no more transfers, from a departure no earlier, already had on offer.
interface State { t: number; day: number; pos: number; k: number; parent: number; at: number }

export function plan(tt: Timetable, from: number, to: number, o: PlanOptions = DEFAULT_OPTIONS): Route[] {
  const ends = (i: number) => (o.sameCityEnds ? tt.city[i] : [i]);
  const origins = ends(from), originSet = new Set(origins), dests = new Set(ends(to));
  const stops = (t: number) => tt.trains[t].stops;

  // the least riding time from each station to a destination (no waits; crossing town counts its change)
  const toDest = new Float64Array(tt.stations.length).fill(Infinity);
  const heap: number[] = []; // [minutes, station] pairs
  const reach = (s: number, m: number) => {
    if (m >= toDest[s]) return;
    toDest[s] = m;
    let i = heap.push(m, s) / 2 - 1;
    for (let u = (i - 1) >> 1; i > 0 && heap[u * 2] > m; i = u, u = (i - 1) >> 1) {
      heap[i * 2] = heap[u * 2]; heap[i * 2 + 1] = heap[u * 2 + 1]; heap[u * 2] = m; heap[u * 2 + 1] = s;
    }
  };
  for (const s of dests) reach(s, 0);
  while (heap.length) {
    const m = heap[0], s = heap[1], zs = heap.pop()!, zm = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length / 2) break;
        if (c + 1 < heap.length / 2 && heap[c * 2 + 2] < heap[c * 2]) c++;
        if (heap[c * 2] >= zm) break;
        heap[i * 2] = heap[c * 2]; heap[i * 2 + 1] = heap[c * 2 + 1]; i = c;
      }
      heap[i * 2] = zm; heap[i * 2 + 1] = zs;
    }
    if (m > toDest[s]) continue;
    const b = tt.before[s];
    for (let q = 0; q < b.length; q += 2) reach(b[q], m + b[q + 1]);
    for (const c of tt.city[s]) if (c !== s) reach(c, m + o.crossTownChange);
  }
  // the same per stop of a train: the least time from leaving there to reaching a destination, on this train or on
  // from one of its later stops
  const onward = new Float64Array(tt.first[tt.trains.length - 1] + stops(tt.trains.length - 1).length / 3);
  tt.trains.forEach(({ stops: T }, t) => {
    let m = Infinity;
    for (let p = T.length / 3 - 1; p >= 0; p--) { onward[tt.first[t] + p] = m - T[p * 3 + 2]; m = Math.min(m, T[p * 3 + 1] + toDest[T[p * 3]]); }
  });

  const states: State[] = [];
  const seen: State[][] = tt.trains.map(() => []); // train → the states it was boarded in, none dominating another
  const board = (t: number, day: number, pos: number, k: number, parent: number, at: number, queue: number[]) => {
    const l = seen[t];
    for (const x of l) if (x.day <= day && x.pos <= pos && x.k <= k) return;
    const s = { t, day, pos, k, parent, at };
    seen[t] = l.filter((x) => !(day <= x.day && pos <= x.pos && k <= x.k));
    seen[t].push(s);
    queue.push(states.push(s) - 1);
  };
  // per station, the departure times a change there has tried: tried[s][k] = sorted, disjoint [first, last] pairs,
  // flat, for changes onto a k-th train or an earlier one
  const tried: number[][][] = tt.stations.map(() => []);
  const firstEnding = (l: number[], t: number) => { // the first pair that ends at or after t
    let b = 0, e = l.length / 2;
    while (b < e) { const m = (b + e) >> 1; if (l[m * 2 + 1] < t) b = m + 1; else e = m; }
    return b * 2;
  };
  const tryAt = (y: number, k: number, lo: number, hi: number) => {
    const levels = tried[y];
    while (levels.length <= k) levels.push(levels.length ? levels[levels.length - 1].slice() : []);
    for (let q = k; q < levels.length; q++) {
      const l = levels[q], b = firstEnding(l, lo - 1);
      let c = b, a = lo, z = hi;
      for (; c < l.length && l[c] <= hi + 1; c += 2) { a = Math.min(a, l[c]); z = Math.max(z, l[c + 1]); }
      l.splice(b, c - b, a, z);
    }
  };

  // the earliest arrival of a route found with at most k transfers
  const best: number[] = [];
  const limit = (k: number) => (best.length ? best[Math.min(k, best.length - 1)] : Number.MAX_VALUE);
  const routes: Route[] = [];
  const legsOf = (i: number, at: number): Leg[] => {
    const legs: Leg[] = [];
    for (let s = states[i]; ; s = states[s.parent]) {
      const T = stops(s.t);
      legs.unshift({ train: tt.trains[s.t].code, trainNo: tt.trains[s.t].no, from: T[s.pos * 3], to: T[at * 3], depart: T[s.pos * 3 + 2] + s.day, arrive: T[at * 3 + 1] + s.day });
      if (s.parent < 0) return legs;
      at = s.at;
    }
  };

  // every departure from an origin, latest first
  const starts: number[][] = [];
  for (const s of origins) { const l = tt.departures[s]; for (let q = 0; q < l.length; q += 3) starts.push([l[q], l[q + 1], l[q + 2]]); }
  starts.sort((a, b) => b[0] - a[0]);
  for (const [d, t0, p0] of starts) {
    let queue: number[] = [];
    board(t0, d - stops(t0)[p0 * 3 + 2], p0, 0, -1, -1, queue);
    for (let k = 0; queue.length; k++) {
      const next: number[] = [];
      for (const i of queue) {
        const s = states[i], T = stops(s.t);
        // ride on until another state of this train takes over (a stop where it boarded on this day or earlier with
        // no more transfers); none if one has replaced this state since
        let end = T.length / 3 - 1, dead = false;
        for (const x of seen[s.t]) {
          if (x === s || x.day > s.day || x.k > s.k) continue;
          if (x.pos <= s.pos) dead = true;
          else end = Math.min(end, x.pos);
        }
        if (dead) continue;
        for (let j = s.pos + 1; j <= end; j++) {
          const a = T[j * 3 + 1] + s.day;
          if (a > limit(k)) break;
          const x = T[j * 3];
          if (dests.has(x)) {
            routes.push({ legs: legsOf(i, j), depart: d, arrive: a, transfers: k });
            while (best.length <= k) best.push(limit(best.length));
            for (let q = k; q < best.length; q++) best[q] = Math.min(best[q], a);
          }
          if (originSet.has(x) || a + toDest[x] > limit(k)) continue; // a route never comes back to where it started
          const lim = limit(k + 1);
          for (const y of tt.city[x]) {
            // the trains leaving y between lo and hi (each runs daily at the same clock time) not yet offered
            const lo = a + (y === x ? o.sameStationChange : o.crossTownChange), hi = a + o.maxWait;
            if (lo + toDest[y] > lim) continue;
            const l = tt.departures[y], n = l.length / 3, levels = tried[y];
            const done = levels.length ? levels[Math.min(k + 1, levels.length - 1)] : [];
            let from = lo, fresh = false;
            gaps: for (let c = firstEnding(done, lo); c <= done.length && from <= hi; c += 2) {
              const to = c < done.length ? Math.min(hi, done[c] - 1) : hi;
              if (to >= from) {
                fresh = true;
                let b = 0, e = n;
                while (b < e) { const m = (b + e) >> 1; if (l[m * 3] < from % 1440) b = m + 1; else e = m; }
                for (let m = 0; m < n; m++) {
                  const q = ((b + m) % n) * 3, dep = from + ((l[q] - (from % 1440) + 1440) % 1440);
                  if (dep > to) break;
                  if (dep + toDest[y] > lim) break gaps;
                  const t2 = l[q + 1], p2 = l[q + 2];
                  if (dep + onward[tt.first[t2] + p2] > lim) continue;
                  board(t2, dep - stops(t2)[p2 * 3 + 2], p2, k + 1, i, j, next);
                }
              }
              if (c < done.length) from = Math.max(from, done[c + 1] + 1);
            }
            if (fresh) tryAt(y, k + 1, lo, hi);
          }
        }
      }
      queue = next;
    }
  }
  return pareto(routes);
}

// keep a route unless another departs no earlier, arrives no later, has no more transfers, and is
// strictly better on one of them; among equals the shortest total wait wins
function pareto(rs: Route[]): Route[] {
  const wait = (r: Route) => r.legs.reduce((w, l, i) => (i ? w + l.depart - r.legs[i - 1].arrive : 0), 0);
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
