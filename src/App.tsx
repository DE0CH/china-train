import { useState, FormEvent } from "react";
import { fetchRoute, type TicketSummary } from "@/lib/train-api";
import { getApiKeyFromCookie, clearApiKeyCookie } from "@/lib/cookies";
import SetupPage from "./SetupPage";

export default function App() {
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== "undefined" ? getApiKeyFromCookie() : ""
  );
  const [start, setStart] = useState("香港西九龙");
  const [transfer, setTransfer] = useState("深圳北");
  const [end, setEnd] = useState("深圳坪山");
  const [date, setDate] = useState("");
  const [transitMinutes, setTransitMinutes] = useState(10);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!apiKey) {
    return (
      <SetupPage
        onSaved={() => setApiKey(getApiKeyFromCookie())}
      />
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await fetchRoute(start, transfer, end, date, apiKey, transitMinutes);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}小时${m}分` : `${m}分`;
  };

  const PRESETS = [
    { label: "西九龙 → 坪山", start: "香港西九龙", transfer: "深圳北", end: "深圳坪山" },
    { label: "坪山 → 西九龙", start: "深圳坪山", transfer: "深圳北", end: "香港西九龙" },
  ];

  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "2rem 1rem",
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>车票查询</h1>
        <button
          type="button"
          onClick={() => {
            clearApiKeyCookie();
            setApiKey("");
          }}
          style={{
            padding: "0.4rem 0.75rem",
            fontSize: "0.9rem",
            color: "#666",
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          退出
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
            常用路线
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setStart(p.start); setTransfer(p.transfer); setEnd(p.end); }}
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.9rem",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  background: start === p.start && transfer === p.transfer && end === p.end ? "#0d6efd" : "#fff",
                  color: start === p.start && transfer === p.transfer && end === p.end ? "#fff" : "#333",
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="station-grid">
          <div>
            <label
              htmlFor="start"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}
            >
              出发站
            </label>
            <input
              id="start"
              type="text"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label
              htmlFor="transfer"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}
            >
              中转站
            </label>
            <input
              id="transfer"
              type="text"
              value={transfer}
              onChange={(e) => setTransfer(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label
              htmlFor="end"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}
            >
              到达站
            </label>
            <input
              id="end"
              type="text"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label
              htmlFor="date"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}
            >
              出发日期
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="date-input"
              style={{
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
              }}
            />
          </div>
          <div>
            <label
              htmlFor="transitMinutes"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}
            >
              最短换乘时间（分钟）
            </label>
            <input
              id="transitMinutes"
              type="number"
              min={0}
              max={120}
              value={transitMinutes}
              onChange={(e) => setTransitMinutes(Math.max(0, parseInt(e.target.value) || 0))}
              style={{
                width: 80,
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
              }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.6rem 1.25rem",
            fontSize: "1rem",
            fontWeight: 500,
            color: "#fff",
            background: loading ? "#999" : "#0d6efd",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            }}
          className="submit-btn"
        >
          {loading ? "查询中…" : "查询"}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: "1rem",
            marginBottom: "1rem",
            background: "#f8d7da",
            color: "#721c24",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {results && (
        <section>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>查询结果</h2>
          {results.length === 0 ? (
            <p style={{ color: "#666" }}>暂无符合条件的车次。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {results.map((row, i) => (
                <div
                  key={i}
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e8e8",
                    borderRadius: 12,
                    padding: "1rem",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  }}
                >
                  {/* Times row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <div style={{ minWidth: 56 }}>
                      <div style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1 }}>{row["出发时间"]}</div>
                      <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 2 }}>{start}</div>
                    </div>

                    <div style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "0.8rem", color: "#f60", marginBottom: 4 }}>
                        全程{formatDuration(row["时长"])}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ flex: 1, height: 1, background: "#ddd" }} />
                        <span style={{
                          fontSize: "0.75rem",
                          padding: "2px 8px",
                          border: "1px solid #ccc",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                          background: "#fafafa",
                        }}>
                          {transfer}
                        </span>
                        <div style={{ flex: 1, height: 1, background: "#ddd" }} />
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#888", marginTop: 4 }}>
                        同站换乘{formatDuration(row["中转时间"])}
                      </div>
                    </div>

                    <div style={{ minWidth: 56, textAlign: "right" }}>
                      <div style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1 }}>{row["到达时间"]}</div>
                      <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 2 }}>{end}</div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: "1px solid #f0f0f0", margin: "0.75rem 0" }} />

                  {/* Ticket availability */}
                  {[
                    { leg: "1程", sw: row["1 商务"], yd: row["1 一等"], ed: row["1 二等"], wz: row["1 站票"], trainno: row["1 车次"] },
                    { leg: "2程", sw: row["2 商务"], yd: row["2 一等"], ed: row["2 二等"], wz: row["2 站票"], trainno: row["2 车次"] },
                  ].map(({ leg, sw, yd, ed, wz, trainno }) => (
                    <div key={leg} style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                      <span style={{ color: "#888", minWidth: 28 }}>{leg}</span>
                      {trainno && (
                        <span style={{
                          fontSize: "0.75rem",
                          background: "#f5f5f5",
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          padding: "1px 5px",
                          fontFamily: "monospace",
                        }}>{trainno}</span>
                      )}
                      <span style={{ marginLeft: "auto", display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span>二等 <b>{ed}</b></span>
                        <span>一等 <b>{yd}</b></span>
                        <span>商务 <b>{sw}</b></span>
                        <span>无座 <b>{wz}</b></span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
