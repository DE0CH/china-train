import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { loadTimetable, plan, searchStations, clock, span, DEFAULT_OPTIONS, type Timetable, type Route, type Leg, type PlanOptions } from "@/lib/planner";
import { seatsFor, addDays, type Seats } from "@/lib/train-api";

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEK = "日一二三四五六";
const PRESETS: Array<[string, string]> = [["香港西九龙", "深圳坪山"], ["深圳坪山", "香港西九龙"]];
const short = (name: string) => name.replace(/^(香港|深圳)(?=..)/, "");

function readPrefs<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writePrefs(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

// ---- station picker ---------------------------------------------------------------------------
function StationPicker({ tt, label, value, onChange, recent }: {
  tt: Timetable | null; label: string; value: number | null; onChange: (i: number) => void; recent: number[];
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const shown = value !== null && tt ? tt.stations[value].name : "";
  useEffect(() => { if (!open) setText(shown); }, [shown, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const hits = useMemo(() => {
    if (!tt) return [];
    const q = text.trim();
    return q && q !== shown ? searchStations(tt, q) : recent.filter((i) => i !== value).slice(0, 8);
  }, [tt, text, shown, recent, value]);
  useEffect(() => setHi(0), [text]);
  const pick = (i: number) => { onChange(i); setOpen(false); setText(tt!.stations[i].name); (document.activeElement as HTMLElement)?.blur(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && hits[hi] !== undefined) { e.preventDefault(); pick(hits[hi]); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className="picker" ref={box}>
      <label>{label}</label>
      <input
        value={text} placeholder={tt ? "站名 / 拼音 / 首字母" : "加载车站…"} disabled={!tt}
        onFocus={(e) => { setOpen(true); e.target.select(); }} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={key}
        autoComplete="off" spellCheck={false}
      />
      {open && tt && hits.length > 0 && (
        <ul className="suggest">
          {!text.trim() || text === shown ? <li className="suggest-head">最近使用</li> : null}
          {hits.map((i, k) => (
            <li key={i} className={k === hi ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setHi(k)}>
              <span className="s-name">{tt.stations[i].name}</span>
              <span className="s-meta">{tt.stations[i].city !== tt.stations[i].name ? tt.stations[i].city + " · " : ""}{tt.stations[i].pinyin}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- seats ------------------------------------------------------------------------------------
type LegState = { seats?: Seats; missing?: boolean; error?: string };
const legKey = (tt: Timetable, l: Leg, date: string) => `${tt.stations[l.from].code}|${tt.stations[l.to].code}|${addDays(date, Math.floor(l.depart / 1440))}`;

function SeatChips({ s }: { s?: LegState }) {
  if (!s) return <span className="seats loading">查询余票…</span>;
  if (s.error) return <span className="seats err">余票查询失败</span>;
  if (s.missing) return <span className="seats err">当日不开行</span>;
  const cls = (v: string) => (v === "有" || /^\d+$/.test(v) ? "ok" : v === "无" ? "none" : "na");
  const items: Array<[string, string]> = [["商务", s.seats!.sw], ["一等", s.seats!.yd], ["二等", s.seats!.ed], ["无座", s.seats!.wz]];
  return (
    <span className="seats">
      {items.filter(([, v]) => v !== "--").map(([k, v]) => <span key={k} className={`chip ${cls(v)}`}>{k} {v === "有" ? "有" : v === "无" ? "无" : v}</span>)}
      {!s.seats!.canBuy && <span className="chip na">未开售</span>}
    </span>
  );
}

type LegQuery = { byTrain: Map<string, Seats>; error?: undefined } | { error: string; byTrain?: undefined };

function RouteCard({ tt, r, date, legs }: { tt: Timetable; r: Route; date: string; legs: Map<string, LegQuery> }) {
  const st = (i: number) => tt.stations[i].name;
  return (
    <article className="route">
      <header>
        <div className="times">
          <span className="t">{clock(r.depart)}</span>
          <span className="arrow"><span>{span(r.arrive - r.depart)}</span></span>
          <span className="t">{clock(r.arrive)}</span>
        </div>
        <span className={`badge ${r.transfers ? "xfer" : "direct"}`}>{r.transfers ? "中转 1 次" : "直达"}</span>
      </header>
      {r.legs.map((l, k) => {
        const q = legs.get(legKey(tt, l, date));
        const legState: LegState | undefined = !q ? undefined : q.error ? { error: q.error }
          : q.byTrain!.has(l.trainNo) ? { seats: q.byTrain!.get(l.trainNo) } : { missing: true };
        return (
          <div key={k}>
            {k > 0 && (
              <div className="change">
                {r.legs[k - 1].to === l.from ? `在 ${st(l.from)} 换乘` : `${st(r.legs[k - 1].to)} → ${st(l.from)} 同城换乘`} · 等 {span(l.depart - r.legs[k - 1].arrive)}
              </div>
            )}
            <div className="leg">
              <span className="train">{(legState?.seats?.code) || l.train}</span>
              <span className="leg-route">{st(l.from)} {clock(l.depart)} → {st(l.to)} {clock(l.arrive)}</span>
              <SeatChips s={legState} />
            </div>
          </div>
        );
      })}
    </article>
  );
}

// ---- page -------------------------------------------------------------------------------------
export default function App() {
  const [tt, setTt] = useState<Timetable | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const today = new Date();
  const [date, setDate] = useState(isoDate(new Date(today.getTime() + 86400000)));
  const [opts, setOpts] = useState<PlanOptions>(() => ({ ...DEFAULT_OPTIONS, ...readPrefs<Partial<PlanOptions>>("opts", {}) }));
  const [showOpts, setShowOpts] = useState(false);
  const [filter, setFilter] = useState<"all" | "direct" | "xfer">("all");
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [legs, setLegs] = useState<Map<string, LegQuery>>(new Map());
  const [recent, setRecent] = useState<string[]>(() => readPrefs<string[]>("recent", []));
  const run = useRef(0);

  useEffect(() => {
    loadTimetable().then((t) => {
      setTt(t);
      const q = new URLSearchParams(location.search);
      const last = readPrefs<[string, string] | null>("last", null);
      const [f, d] = q.get("from") && q.get("to") ? [q.get("from")!, q.get("to")!] : last ?? PRESETS[0];
      const idx = (s: string) => t.byCode.get(s) ?? t.stations.findIndex((x) => x.name === s);
      if (idx(f) >= 0) setFrom(idx(f));
      if (idx(d) >= 0) setTo(idx(d));
    }).catch((e) => setLoadErr(e.message));
  }, []);
  useEffect(() => writePrefs("opts", opts), [opts]);

  const recentIdx = useMemo(() => {
    if (!tt) return [];
    const names = [...recent, ...PRESETS.flat()];
    return [...new Set(names.map((n) => tt.stations.findIndex((s) => s.name === n)).filter((i) => i >= 0))];
  }, [tt, recent]);
  const remember = (i: number) => { if (!tt) return; const r = [tt.stations[i].name, ...recent.filter((n) => n !== tt.stations[i].name)].slice(0, 8); setRecent(r); writePrefs("recent", r); };

  function search() {
    if (!tt || from === null || to === null || from === to) return;
    const id = ++run.current;
    writePrefs("last", [tt.stations[from].name, tt.stations[to].name]);
    const rs = plan(tt, from, to, opts);
    setRoutes(rs);
    setLegs(new Map());
    // live seats for every leg shown, a few queries at a time
    const keys = [...new Set(rs.flatMap((r) => r.legs.map((l) => legKey(tt, l, date))))];
    let next = 0;
    const worker = async () => {
      while (next < keys.length && run.current === id) {
        const k = keys[next++];
        const [f, t, d] = k.split("|");
        let v: LegQuery;
        try { v = { byTrain: await seatsFor(f, t, d) }; } catch (e: any) { v = { error: e.message }; }
        if (run.current === id) setLegs((m) => new Map(m).set(k, v));
      }
    };
    for (let i = 0; i < 4; i++) worker();
  }
  useEffect(() => { if (tt && from !== null && to !== null) search(); /* eslint-disable-next-line */ }, [tt, from, to, date, opts]);

  // a route is hidden once 12306 says one of its trains does not run that day
  const runs = (r: Route) => r.legs.every((l) => { const s = legs.get(legKey(tt!, l, date)); return !s || !!s.error || s.byTrain!.has(l.trainNo); });
  const visible = routes?.filter(runs).filter((r) => filter === "all" || (filter === "direct" ? r.transfers === 0 : r.transfers > 0)) ?? [];
  const hidden = routes ? routes.filter((r) => !runs(r)).length : 0;
  const pending = routes ? routes.some((r) => r.legs.some((l) => !legs.has(legKey(tt!, l, date)))) : false;

  const days = Array.from({ length: 15 }, (_, i) => new Date(today.getTime() + i * 86400000));

  return (
    <main>
      <header className="top">
        <h1>火车路线规划</h1>
        <span className="sub">全国时刻表 · 余票实时来自 12306{tt ? ` · 时刻表 ${tt.generated.slice(0, 10)}` : ""}</span>
      </header>

      {loadErr && <p className="error">{loadErr}</p>}

      <section className="panel">
        <div className="ends">
          <StationPicker tt={tt} label="出发" value={from} onChange={(i) => { setFrom(i); remember(i); }} recent={recentIdx} />
          <button className="swap" type="button" aria-label="交换出发和到达" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
          <StationPicker tt={tt} label="到达" value={to} onChange={(i) => { setTo(i); remember(i); }} recent={recentIdx} />
        </div>

        <div className="days" role="tablist">
          {days.map((d) => {
            const iso = isoDate(d);
            const rel = ["今天", "明天", "后天"][Math.round((d.getTime() - today.getTime()) / 86400000)];
            return (
              <button key={iso} type="button" className={iso === date ? "day on" : "day"} onClick={() => setDate(iso)}>
                <span>{rel ?? `周${WEEK[d.getDay()]}`}</span>
                <b>{d.getMonth() + 1}/{d.getDate()}</b>
              </button>
            );
          })}
        </div>

        <div className="presets">
          {PRESETS.map(([a, b]) => (
            <button key={a + b} type="button" className="preset" onClick={() => { if (!tt) return; setFrom(tt.stations.findIndex((s) => s.name === a)); setTo(tt.stations.findIndex((s) => s.name === b)); }}>
              {short(a)} → {short(b)}
            </button>
          ))}
          <button type="button" className="preset ghost" onClick={() => setShowOpts((v) => !v)}>换乘设置 {showOpts ? "▴" : "▾"}</button>
        </div>

        {showOpts && (
          <div className="opts">
            <label>同站换乘至少 <input type="number" min={0} max={120} value={opts.sameStationChange} onChange={(e) => setOpts({ ...opts, sameStationChange: +e.target.value || 0 })} /> 分钟</label>
            <label>同城换站至少 <input type="number" min={0} max={240} value={opts.crossTownChange} onChange={(e) => setOpts({ ...opts, crossTownChange: +e.target.value || 0 })} /> 分钟</label>
            <label>最长等待 <input type="number" min={10} max={720} value={opts.maxWait} onChange={(e) => setOpts({ ...opts, maxWait: +e.target.value || 0 })} /> 分钟</label>
            <label className="check"><input type="checkbox" checked={opts.sameCityEnds} onChange={(e) => setOpts({ ...opts, sameCityEnds: e.target.checked })} /> 出发/到达包括同城其他车站</label>
          </div>
        )}
      </section>

      {routes && tt && (
        <section>
          <div className="filters">
            {(["all", "direct", "xfer"] as const).map((f) => (
              <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {{ all: "全部", direct: "直达", xfer: "中转" }[f]}
              </button>
            ))}
            <span className="count">{visible.length} 个方案{pending ? " · 正在核对余票…" : ""}{hidden ? ` · 已隐藏 ${hidden} 个当日不开行` : ""}</span>
          </div>
          {visible.length === 0 && !pending && <p className="empty">没有找到方案。可以在「换乘设置」里放宽等待时间，或包括同城其他车站。</p>}
          {visible.map((r, i) => <RouteCard key={i} tt={tt} r={r} date={date} legs={legs} />)}
        </section>
      )}
    </main>
  );
}
