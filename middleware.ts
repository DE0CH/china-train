// Vercel Edge Middleware: every request must carry a valid Cloudflare Access JWT.
//
// The site is reachable only through https://train.deyaochen.com, a Cloudflare-proxied hostname
// with a Cloudflare Access application (policy: Deyao's email, plus the agent service token).
// Cloudflare sets `Cf-Access-Jwt-Assertion` (and the CF_Authorization cookie) on requests it lets
// through; this middleware verifies that token against the team's public keys and the app's AUD,
// so the bare *.vercel.app hostname — which bypasses Cloudflare — cannot be used to query 12306
// and burn proxy traffic. Env: CF_ACCESS_TEAM_DOMAIN (e.g. de0ch.cloudflareaccess.com),
// CF_ACCESS_AUD (the Access application's audience tag), PUBLIC_HOST (train.deyaochen.com).
import { createRemoteJWKSet, jwtVerify } from "jose";

export const config = { matcher: "/(.*)" };

const TEAM = process.env.CF_ACCESS_TEAM_DOMAIN || "";
const AUD = process.env.CF_ACCESS_AUD || "";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "train.deyaochen.com";
const JWKS = TEAM ? createRemoteJWKSet(new URL(`https://${TEAM}/cdn-cgi/access/certs`)) : null;

function tokenFrom(req: Request): string | null {
  const h = req.headers.get("cf-access-jwt-assertion");
  if (h) return h;
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

export default async function middleware(req: Request) {
  const url = new URL(req.url);
  if (!TEAM || !AUD || !JWKS) {
    return new Response(JSON.stringify({ error: "access guard not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD)" }), { status: 503, headers: { "content-type": "application/json" } });
  }
  const token = tokenFrom(req);
  let ok = false;
  if (token) {
    try { await jwtVerify(token, JWKS, { issuer: `https://${TEAM}`, audience: AUD }); ok = true; } catch { ok = false; }
  }
  if (ok) return; // continue to the page / function
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "未授权：请通过 " + PUBLIC_HOST + " 访问并登录 Cloudflare Access" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  // a page request on the wrong hostname (or without a session): send it to the guarded hostname,
  // where Cloudflare Access runs its login
  if (url.hostname !== PUBLIC_HOST) return Response.redirect(`https://${PUBLIC_HOST}${url.pathname}${url.search}`, 302);
  return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
}
