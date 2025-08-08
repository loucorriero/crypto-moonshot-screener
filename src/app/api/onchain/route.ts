import { NextResponse } from "next/server";

// This API endpoint provides stubbed on‑chain metrics for a set of tokens.
// In a production application you might integrate with services such as
// GeckoTerminal or DEXScreener to fetch pool liquidity, holder counts and
// other DeFi analytics.  Here we simply return static values for demo
// purposes.

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
  // Generate deterministic pseudo‑random metrics based on string hashing.  This
  // ensures that the same ID always yields the same numbers on a given
  // deployment.
  function hash(str: string) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b1);
    }
    return h >>> 0;
  }
  const result = ids.map((id) => {
    const h = hash(id);
    const liquidity = ((h % 1000) + 500) * 1000; // between 500k and 1.5M
    const holders = ((h >> 8) % 50000) + 1000; // between 1k and 51k
    return {
      id,
      liquidity,
      holders,
    };
  });
  return NextResponse.json(result);
}