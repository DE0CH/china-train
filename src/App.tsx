import { useState, FormEvent, useEffect } from "react";
import { fetchRoute, type TicketSummary, type RouteKey } from "@/lib/train-api";

const API_KEY_STORAGE = "china-train-api-key";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [route, setRoute] = useState<RouteKey>("香港 到 坪山");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    if (stored) setApiKey(stored);
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
  }, [apiKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date.trim()) return;
    const key = apiKey.trim();
    if (!key) {
      setError("请先填写您的 API Key（APPCODE）");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await fetchRoute(route, date, key);
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
    return `${h}小时${m}分`;
  };

  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "2rem 1rem",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.75rem" }}>车票查询</h1>

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
          <label
            htmlFor="apiKey"
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
            }}
          >
            API Key (APPCODE)
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="您的阿里云市场 APPCODE"
            autoComplete="off"
            style={{
              width: "100%",
              maxWidth: 360,
              padding: "0.5rem 0.75rem",
              fontSize: "1rem",
              border: "1px solid #ccc",
              borderRadius: 6,
            }}
          />
          <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#666" }}>
            从 <a href="https://market.aliyun.com/products/57126001/cmapi028426.html" target="_blank" rel="noopener noreferrer">阿里云 API 市场</a> 获取，仅保存在本地浏览器中
          </p>
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: 500,
            }}
          >
            路线
          </label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="radio"
                name="route"
                value="香港 到 坪山"
                checked={route === "香港 到 坪山"}
                onChange={() => setRoute("香港 到 坪山")}
              />
              香港 到 坪山
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="radio"
                name="route"
                value="坪山 到 香港"
                checked={route === "坪山 到 香港"}
                onChange={() => setRoute("坪山 到 香港")}
              />
              坪山 到 香港
            </label>
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
            style={{
              width: "100%",
              maxWidth: 240,
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
            alignSelf: "flex-start",
          }}
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
