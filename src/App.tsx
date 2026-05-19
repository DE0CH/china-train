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
      const data = await fetchRoute(start, transfer, end, date, apiKey);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const formatDuration = (minutes: number) => `${minutes}`;

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

        <div>
          <label
            htmlFor="date"
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
            }}
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
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #dee2e6" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      出发时间
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      到达时间
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      时长
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      中转时间
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      1 商务
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      1 一等
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      1 二等
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      1 站票
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      2 商务
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      2 一等
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      2 二等
                    </th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>
                      2 站票
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid #dee2e6",
                        background: i % 2 === 1 ? "#f8f9fa" : undefined,
                      }}
                    >
                      <td style={{ padding: "0.75rem" }}>{row["出发时间"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["到达时间"]}</td>
                      <td style={{ padding: "0.75rem" }}>
                        {formatDuration(row["时长"])}
                      </td>
                      <td style={{ padding: "0.75rem" }}>
                        {formatDuration(row["中转时间"])}
                      </td>
                      <td style={{ padding: "0.75rem" }}>{row["1 商务"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["1 一等"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["1 二等"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["1 站票"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["2 商务"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["2 一等"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["2 二等"]}</td>
                      <td style={{ padding: "0.75rem" }}>{row["2 站票"]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
