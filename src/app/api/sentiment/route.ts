import { NextResponse } from "next/server";

// This endpoint returns mock sentiment data for a set of tokens.  In
// production you could integrate with a social analytics provider such as
// LunarCrush or Santiment to measure community engagement, bullish/bearish
// ratios and trending scores.  The values returned here are randomly
// generated within a fixed range for demonstration purposes.

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
  function seedRandom(str: string) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    return () => {
      h += 0x6d2b79f5;
      let t = Math.imul(h ^ (h >>> 15), h | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const result = ids.map((id) => {
    const rand = seedRandom(id);
    return {
      id,
      bullishScore: Math.round(rand() * 100), // 0–100
      bearishScore: Math.round(rand() * 100),
      mentionVolume: Math.round(rand() * 10000),
    };
  });
  return NextResponse.json(result);
}