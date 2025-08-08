import { NextResponse } from "next/server";

/**
 * This endpoint provides simple "news" or catalyst alerts by checking
 * whether a given token is currently trending on CoinGecko.  The CoinGecko
 * `/search/trending` endpoint returns a list of coins that are generating
 * heightened interest on the platform.  We treat a token appearing on
 * this list as a potential catalyst and construct an alert message.  If
 * a token is not trending or the external request fails, the alerts
 * array will be empty for that token.
 *
 * Query parameters:
 *   ids – a comma‑separated list of CoinGecko IDs to evaluate.
 *
 * Response format:
 *   [ { id: string, updates: { title: string, description: string, created_at: string, rank?: number }[] }, ... ]
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json(
      { error: "Missing 'ids' query parameter" },
      { status: 400 }
    );
  }
  const ids = idsParam.split(",");
  try {
    // Fetch the list of trending coins from CoinGecko.  This endpoint
    // highlights coins that are seeing elevated search volume.  We do
    // not specify any query parameters so we get the default list (7 items).
    const trendingRes = await fetch(
      "https://api.coingecko.com/api/v3/search/trending",
      { headers: { accept: "application/json" } }
    );
    if (!trendingRes.ok) {
      throw new Error(`Trending request failed: ${trendingRes.status}`);
    }
    const trendingData = await trendingRes.json();
    const trendingCoins: any[] = Array.isArray(trendingData?.coins)
      ? trendingData.coins
      : [];
    // Build a lookup of id → { rank, name } for quick access.  The rank is
    // determined by the order in the trending list (1‑based).  We store
    // the human‑readable name to construct a friendly alert message.
    const trendingMap: Record<string, { rank: number; name: string }> = {};
    trendingCoins.forEach((entry: any, index: number) => {
      const item = entry?.item;
      if (item?.id) {
        trendingMap[item.id] = { rank: index + 1, name: item.name || item.id };
      }
    });
    // Assemble the response for each requested id.  If the id is trending,
    // include an alert; otherwise leave the updates array empty.
    const results = ids.map((id) => {
      const trending = trendingMap[id];
      if (trending) {
        return {
          id,
          updates: [
            {
              title: `${trending.name} is trending on CoinGecko`,
              description: `${trending.name} currently ranks #${trending.rank} on CoinGecko's trending search list.`,
              created_at: new Date().toISOString(),
              rank: trending.rank,
            },
          ],
        };
      }
      return { id, updates: [] };
    });
    return NextResponse.json(results);
  } catch (err) {
    // On error, return empty updates for all ids.  Logging is omitted to
    // avoid exposing implementation details to the client.
    const empty = ids.map((id) => ({ id, updates: [] }));
    return NextResponse.json(empty);
  }
}