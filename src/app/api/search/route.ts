import { NextResponse } from "next/server";

// Proxy search requests to the CoinGecko search API.  This endpoint takes a
// `query` string parameter and returns matching coins from CoinGecko's
// `/search` endpoint.  Only the coins array is returned to reduce payload size.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "Missing 'query' query parameter" },
      { status: 400 }
    );
  }
  const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(
    query
  )}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      throw new Error(`Failed to fetch search results: ${res.status}`);
    }
    const data = await res.json();
    // Return only the coins array to the client.
    return NextResponse.json({ coins: data.coins });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}