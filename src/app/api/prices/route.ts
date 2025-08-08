import { NextResponse } from "next/server";

// Reusable function to fetch price data from CoinGecko.  CoinGecko API
// documentation: https://www.coingecko.com/en/api/documentation.  We use
// /coins/markets to retrieve current price and change percentages for a set
// of IDs.  Note: no API key is required for basic usage.  In production
// applications you may want to cache responses to stay within rate limits.
async function fetchPrices(ids: string[], vsCurrency: string = "usd") {
  const params = new URLSearchParams({
    vs_currency: vsCurrency,
    ids: ids.join(","),
    // Request both 24h and 7d change percentages.  Without this, the API
    // returns only the 24h change.
    price_change_percentage: "24h,7d",
  });
  const url = `https://api.coingecko.com/api/v3/coins/markets?${params}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch prices: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as any[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");
    const vs = searchParams.get("vs_currency") ?? "usd";
    if (!idsParam) {
      return NextResponse.json(
        { error: "Missing 'ids' query parameter" },
        { status: 400 }
      );
    }
    const ids = idsParam.split(",");
    const data = await fetchPrices(ids, vs);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}