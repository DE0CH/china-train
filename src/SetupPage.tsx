import { useState, FormEvent } from "react";
import { setApiKeyCookie } from "@/lib/cookies";

type Props = { onSaved: () => void };

export default function SetupPage({ onSaved }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    setApiKeyCookie(key);
    setSaved(true);
    onSaved();
  }

  return (
    <main
      style={{
        maxWidth: "480px",
        margin: "0 auto",
        padding: "2rem 1rem",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.75rem" }}>设置 API Key</h1>
      <p style={{ marginBottom: "1.5rem", color: "#666", fontSize: "0.95rem" }}>
        本应用直接向阿里云火车票 API 请求数据，需使用您自己的 APPCODE。密钥仅保存在您的浏览器（Cookie）中，不会上传到任何服务器。
      </p>

      {saved ? (
        <p style={{ color: "green", fontWeight: 500 }}>已保存</p>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
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
              placeholder="请输入您的 APPCODE"
              autoComplete="off"
              required
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "1rem",
                border: "1px solid #ccc",
                borderRadius: 6,
              }}
            />
            <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#666" }}>
              在{" "}
              <a
                href="https://market.aliyun.com/products/57126001/cmapi028426.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                阿里云 API 市场
              </a>{" "}
              购买/订阅后即可获取 APPCODE。
            </p>
          </div>

          <button
            type="submit"
            disabled={!apiKey.trim()}
            style={{
              padding: "0.6rem 1.25rem",
              fontSize: "1rem",
              fontWeight: 500,
              color: "#fff",
              background: apiKey.trim() ? "#0d6efd" : "#999",
              border: "none",
              borderRadius: 6,
              cursor: apiKey.trim() ? "pointer" : "not-allowed",
              alignSelf: "flex-start",
            }}
          >
            保存并进入查询
          </button>
        </form>
      )}
    </main>
  );
}
