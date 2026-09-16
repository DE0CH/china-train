// Remaining traffic on the IPRoyal residential sub-user the query function proxies through.
//
//   GET /api/proxy-status -> { configured, availableMb, usedMb, estimatedSearches, low, exhausted,
//                              lowThresholdMb, perSearchKb, checkedAt }
//
// Env (Vercel): IPROYAL_API (management-API bearer token), IPROYAL_SUBUSER_HASH (the sub-user
// whose credentials are in PROXY_URL). Cached for 60 s per instance so the page can poll freely.
// A two-leg search (both directions of a transfer) moves roughly 150 KB through the proxy.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const PER_SEARCH_KB = 150;
const LOW_MB = Number(process.env.PROXY_LOW_MB || 30);
const EXHAUSTED_MB = 1;

let cache: { at: number; body: any } | null = null;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const token = process.env.IPROYAL_API, hash = process.env.IPROYAL_SUBUSER_HASH;
  if (!process.env.PROXY_URL || !token || !hash) return res.status(200).json({ configured: false });
  if (cache && Date.now() - cache.at < 60 * 1000) return res.status(200).json(cache.body);
  try {
    const r = await fetch(`https://resi-api.iproyal.com/v1/residential-subusers/${encodeURIComponent(hash)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`IPRoyal API ${r.status}`);
    const d: any = await r.json();
    const availableGb = Number(d.traffic_available ?? 0), usedGb = Number(d.traffic_used ?? 0);
    const availableMb = Math.max(0, Math.round(availableGb * 1024 * 10) / 10);
    const body = {
      configured: true,
      availableMb,
      usedMb: Math.round(usedGb * 1024 * 10) / 10,
      estimatedSearches: Math.floor((availableMb * 1024) / PER_SEARCH_KB),
      low: availableMb < LOW_MB,
      exhausted: availableMb < EXHAUSTED_MB,
      lowThresholdMb: LOW_MB,
      perSearchKb: PER_SEARCH_KB,
      checkedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), body };
    return res.status(200).json(body);
  } catch (e: any) {
    return res.status(200).json({ configured: true, error: `无法读取代理余量（${e.message}）` });
  }
}
