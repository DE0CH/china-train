import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchRoute, type RouteKey } from "../lib/train-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 5001;
const isProduction = process.env.NODE_ENV === "production";

app.get("/api/train", async (req, res) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "API_KEY not configured" });
    return;
  }

  const route = req.query.route as RouteKey | undefined;
  const date = req.query.date as string | undefined;

  if (!route || !date) {
    res.status(400).json({ error: "Missing route or date" });
    return;
  }

  if (route !== "香港 到 坪山" && route !== "坪山 到 香港") {
    res.status(400).json({ error: "Invalid route" });
    return;
  }

  try {
    const results = await fetchRoute(route, date, apiKey);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Train API request failed",
    });
  }
});

if (isProduction) {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  if (!isProduction) {
    console.log("API: GET /api/train?route=...&date=...");
  }
});
