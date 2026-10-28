import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { loadTimetable, plan, searchStations, clock, span, DEFAULT_OPTIONS, type Timetable, type Route, type Leg, type PlanOptions } from "@/lib/planner";
import { seatsFor, addDays, type Seats } from "@/lib/train-api";

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WEEK = "日一二三四五六";
const PRESETS: Array<[string, string]> = [["香港西九龙", "深圳坪山"], ["深圳坪山", "香港西九龙"]];
const short = (name: string) => name.replace(/^(香港|深圳)(?=..)/, "");
const pinyinLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

function readPrefs<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writePrefs(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

// ---- icons: one set, 24 viewBox, 2px stroke, square caps ------------------------------------------
const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden="true"><path d={d} /></svg>
);
const SWAP = "M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const CHEVRON_UP = "M6 15l6-6 6 6";
const CROSS = "M6 6l12 12M18 6L6 18";

// ---- station picker: a station-name sign you can type into ---------------------------------------
function StationPicker({ tt, label, value, onChange, recent, align }: {
  tt: Timetable | null; label: string; value: number | null; onChange: (i: number) => void; recent: number[]; align: "start" | "end";
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const station = value !== null && tt ? tt.stations[value] : null;
  const shown = station?.name ?? "";
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
  const id = `pick-${label}`;
  return (
    <div className={`sign sign-${align}`} ref={box}>
      <span className="sign-track" aria-hidden="true"><span className="node" /></span>
      <label htmlFor={id}>{label}</label>
      <input
        id={id} value={text} placeholder={tt ? "站名、拼音或首字母" : "正在载入车站"} disabled={!tt}
        onFocus={(e) => { setOpen(true); e.target.select(); }} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={key}
        autoComplete="off" spellCheck={false} role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
      />
      <span className="pinyin">{station && !open ? pinyinLabel(station.pinyin) : " "}</span>
      {open && tt && hits.length > 0 && (
        <ul className="suggest" id={`${id}-list`} role="listbox">
          {!text.trim() || text === shown ? <li className="suggest-head" aria-hidden="true">最近使用</li> : null}
          {hits.map((i, k) => (
            <li key={i} role="option" aria-selected={k === hi} className={k === hi ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setHi(k)}>
              <span className="s-name">{tt.stations[i].name}</span>
              <span className="s-meta">{tt.stations[i].city !== tt.stations[i].name ? `${tt.stations[i].city}　` : ""}{pinyinLabel(tt.stations[i].pinyin)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- seats ------------------------------------------------------------------------------------
type LegState = { seats?: Seats; missing?: boolean; error?: string };
type LegQuery = { byTrain: Map<string, Seats>; error?: undefined } | { error: string; byTrain?: undefined };
const legKey = (tt: Timetable, l: Leg, date: string) => `${tt.stations[l.from].code}|${tt.stations[l.to].code}|${addDays(date, Math.floor(l.depart / 1440))}`;

function SeatList({ s }: { s?: LegState }) {
  if (!s) return <span className="seats pending">正在查询余票</span>;
  if (s.error) return <span className="seats bad"><Icon d={CROSS} size={16} />余票查询失败</span>;
  if (s.missing) return <span className="seats bad"><Icon d={CROSS} size={16} />当日不开行</span>;
  const state = (v: string) => (v === "有" || /^\d+$/.test(v) ? "ok" : "none");
  const items: Array<[string, string]> = [["商务", s.seats!.sw], ["一等", s.seats!.yd], ["二等", s.seats!.ed], ["无座", s.seats!.wz]];
  return (
    <span className="seats">
      {!s.seats!.canBuy && <span className="seat none">暂不售票</span>}
      {items.filter(([, v]) => v !== "--").map(([k, v]) => (
        <span key={k} className={`seat ${state(v)}`}><span>{k}</span><b>{v}</b></span>
      ))}
    </span>
  );
}

const trainClass = (code: string) => (/^[GCD]/.test(code) ? code[0] : "P");
const CLASS_NAME: Record<string, string> = { G: "高铁", D: "动车", C: "城际", P: "普速" };

// ---- a route drawn as a line diagram: station nodes, one coloured line per train, interchanges ----
function Stop({ name, times, note, pos, inLine, outLine, xchg }: {
  name: string; times: Array<[string, string]>; note?: string; pos: "first" | "mid" | "last"; inLine?: string; outLine?: string; xchg?: boolean;
}) {
  return (
    <li className={`stop stop-${pos}${inLine ? ` in-${inLine}` : ""}${outLine ? ` out-${outLine}` : ""}`}>
      <span className="track" aria-hidden="true"><span className={xchg ? "node xchg" : "node"} /></span>
      <span className="stop-text">
        <span className="stop-name">{name}</span>
        {times.map(([t, k]) => <span key={k} className="stop-time"><b>{t}</b>{k && <span>{k}</span>}</span>)}
        {note && <span className="stop-note">{note}</span>}
      </span>
    </li>
  );
}

function RouteRow({ tt, r, date, legs }: { tt: Timetable; r: Route; date: string; legs: Map<string, LegQuery> }) {
  const st = (i: number) => tt.stations[i].name;
  const info = r.legs.map((l) => {
    const q = legs.get(legKey(tt, l, date));
    const ls: LegState | undefined = !q ? undefined : q.error ? { error: q.error }
      : q.byTrain!.has(l.trainNo) ? { seats: q.byTrain!.get(l.trainNo) } : { missing: true };
    const code = ls?.seats?.code || l.train;
    return { l, ls, code, cls: trainClass(code) };
  });
  const parts: JSX.Element[] = [];
  info.forEach(({ l, ls, code, cls }, k) => {
    if (k === 0) parts.push(<Stop key="s0" pos="first" name={st(l.from)} times={[[clock(l.depart), "开"]]} outLine={cls} />);
    else {
      const p = info[k - 1], wait = span(l.depart - p.l.arrive);
      if (p.l.to === l.from) {
        parts.push(<Stop key={`x${k}`} pos="mid" xchg name={st(l.from)} times={[[clock(p.l.arrive), "到"], [clock(l.depart), "开"]]} note={`换乘，等候${wait}`} inLine={p.cls} outLine={cls} />);
      } else {
        parts.push(<Stop key={`a${k}`} pos="mid" xchg name={st(p.l.to)} times={[[clock(p.l.arrive), "到"]]} inLine={p.cls} outLine="W" />);
        parts.push(
          <li key={`w${k}`} className="walk" style={{ flexGrow: l.depart - p.l.arrive }}>
            <span className="track" aria-hidden="true"><span className="bar" /></span>
            <span className="walk-text">{st(p.l.to)}出站，到{st(l.from)}换乘，等候{wait}</span>
          </li>
        );
        parts.push(<Stop key={`b${k}`} pos="mid" xchg name={st(l.from)} times={[[clock(l.depart), "开"]]} inLine="W" outLine={cls} />);
      }
    }
    parts.push(
      <li key={`l${k}`} className={`leg line-${cls}`} style={{ flexGrow: l.arrive - l.depart }}>
        <span className="track" aria-hidden="true"><span className="bar" /></span>
        <span className="leg-info">
          <span className="leg-head"><span className="train">{code}</span><span className="leg-dur">{CLASS_NAME[cls]}，{span(l.arrive - l.depart)}</span></span>
          <SeatList s={ls} />
        </span>
      </li>
    );
    if (k === info.length - 1) parts.push(<Stop key="end" pos="last" name={st(l.to)} times={[[clock(l.arrive), "到"]]} inLine={cls} />);
  });
  // one verdict for the whole route: every leg needs at least one class on sale
  const avail = (x?: Seats) => !!x && x.canBuy && [x.sw, x.yd, x.ed, x.wz].some((v) => v === "有" || /^\d+$/.test(v));
  const verdict = info.some((i) => !i.ls) ? "pending" : info.some((i) => i.ls!.error) ? "error"
    : info.every((i) => avail(i.ls!.seats)) ? "ok" : "none";
  return (
    <li className="route">
      <div className="when">
        <span className="t">{clock(r.depart)}</span>
        <span className="t arr">{clock(r.arrive)}</span>
        <span className="dur">{span(r.arrive - r.depart)}</span>
        <span className="kind">{r.transfers ? `中转${r.transfers}次` : "直达"}</span>
        <span className={`verdict v-${verdict}`}>
          {verdict !== "pending" && <span className="pip" aria-hidden="true" />}
          {{ pending: "查询中", error: "查询失败", ok: "有票", none: "无票" }[verdict]}
        </span>
      </div>
      <ol className="diagram" aria-label="路线">{parts}</ol>
    </li>
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
        {tt && <p className="sub">时刻表更新于 {tt.generated.slice(5, 10).replace("-", "月")}日，余票实时查询 12306</p>}
      </header>

      {loadErr && <p className="error">{loadErr}</p>}

      <section className="board" aria-label="查询">
        <div className="ends">
          <StationPicker tt={tt} label="出发站" value={from} onChange={(i) => { setFrom(i); remember(i); }} recent={recentIdx} align="start" />
          <div className="swap-cell">
            <button className="swap" type="button" aria-label="交换出发站和到达站" onClick={() => { setFrom(to); setTo(from); }}><Icon d={SWAP} /></button>
            <span className="swap-label" aria-hidden="true">交换</span>
          </div>
          <StationPicker tt={tt} label="到达站" value={to} onChange={(i) => { setTo(i); remember(i); }} recent={recentIdx} align="end" />
        </div>

        <div className="days" role="tablist" aria-label="乘车日期">
          {days.map((d) => {
            const iso = isoDate(d);
            const rel = ["今天", "明天", "后天"][Math.round((d.getTime() - today.getTime()) / 86400000)];
            return (
              <button key={iso} type="button" role="tab" aria-selected={iso === date} className={iso === date ? "day on" : "day"} onClick={() => setDate(iso)}>
                <span>{rel ?? `周${WEEK[d.getDay()]}`}</span>
                <b>{d.getMonth() + 1}.{d.getDate()}</b>
              </button>
            );
          })}
        </div>

        <div className="tools">
          {PRESETS.map(([a, b]) => (
            <button key={a + b} type="button" className="preset" onClick={() => { if (!tt) return; setFrom(tt.stations.findIndex((s) => s.name === a)); setTo(tt.stations.findIndex((s) => s.name === b)); }}>
              {short(a)}到{short(b)}
            </button>
          ))}
          <button type="button" className="preset settings" aria-expanded={showOpts} onClick={() => setShowOpts((v) => !v)}>
            换乘设置 <Icon d={showOpts ? CHEVRON_UP : CHEVRON_DOWN} size={16} />
          </button>
        </div>

        {showOpts && (
          <div className="opts">
            <label>同站换乘至少 <input type="number" min={0} max={120} value={opts.sameStationChange} onChange={(e) => setOpts({ ...opts, sameStationChange: +e.target.value || 0 })} /> 分钟</label>
            <label>同城换站至少 <input type="number" min={0} max={240} value={opts.crossTownChange} onChange={(e) => setOpts({ ...opts, crossTownChange: +e.target.value || 0 })} /> 分钟</label>
            <label>最长等候 <input type="number" min={10} max={720} value={opts.maxWait} onChange={(e) => setOpts({ ...opts, maxWait: +e.target.value || 0 })} /> 分钟</label>
            <label className="check"><input type="checkbox" checked={opts.sameCityEnds} onChange={(e) => setOpts({ ...opts, sameCityEnds: e.target.checked })} /> 也从同城其他车站出发、到达</label>
          </div>
        )}
      </section>

      {routes && tt && (
        <section aria-label="方案">
          <div className="filters">
            <div className="seg" role="tablist">
              {(["all", "direct", "xfer"] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {{ all: "全部", direct: "直达", xfer: "中转" }[f]}
                </button>
              ))}
            </div>
            <span className="count">{visible.length} 个方案{pending ? "，正在核对余票" : ""}{hidden ? `，${hidden} 个当日不开行已隐藏` : ""}</span>
          </div>
          {visible.length > 0 && (
            <ul className="legend" aria-label="线路颜色">
              {(["G", "D", "C", "P"] as const).filter((c) => visible.some((r) => r.legs.some((l) => trainClass(l.train) === c))).map((c) => (
                <li key={c}><span className={`swatch line-${c}`} aria-hidden="true" />{CLASS_NAME[c]}</li>
              ))}
              {visible.some((r) => r.legs.some((l, k) => k > 0 && r.legs[k - 1].to !== l.from)) && <li><span className="swatch walk-swatch" aria-hidden="true" />出站换乘</li>}
            </ul>
          )}
          {visible.length === 0 && !pending && <p className="empty">没有找到方案。在换乘设置里延长最长等候，或勾选同城其他车站，再看一次。</p>}
          <ol className="routes">
            {visible.map((r, i) => <RouteRow key={i} tt={tt} r={r} date={date} legs={legs} />)}
          </ol>
        </section>
      )}
    </main>
  );
}
