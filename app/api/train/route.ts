import { NextRequest } from "next/server";
import { fetchRoute, type RouteKey } from "@/lib/train-api";

export async function GET(request: NextRequest) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const route = searchParams.get("route") as RouteKey | null;
  const date = searchParams.get("date");

  if (!route || !date) {
    return new Response(
      JSON.stringify({ error: "Missing route or date" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (route !== "香港 到 坪山" && route !== "坪山 到 香港") {
    return new Response(
      JSON.stringify({ error: "Invalid route" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const results = await fetchRoute(route, date, apiKey);
    return Response.json(results);
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Train API request failed",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
