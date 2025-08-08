"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Asset represents a crypto currency returned from our pricing API.  It includes
 * both current price information and recent performance metrics.  Additional
 * properties may be present but are ignored here.
 */
interface Asset {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h?: number;
  price_change_percentage_7d_in_currency?: number;
  market_cap?: number;
  total_volume?: number;
  [key: string]: any;
  // The computed score is added client‑side based on the risk bias.  It is
  // derived from recent price change percentages.
  score?: number;
  // Sentiment metrics returned from the /api/sentiment endpoint.  These
  // scores represent bullish/bearish sentiment and raw mention volume.  A
  // higher bullishScore suggests more positive chatter, while a higher
  // bearishScore reflects more negative posts.  Mention volume indicates
  // overall social activity.
  bullishScore?: number;
  bearishScore?: number;
  mentionVolume?: number;
  // On‑chain metrics returned from the /api/onchain endpoint.  Liquidity
  // approximates how much capital is locked in pools for the token and
  // holders denotes the number of unique wallets.  These values help gauge
  // market depth and decentralisation respectively.
  liquidity?: number;
  holders?: number;
}

/**
 * The list of assets to display.  This array drives the API call by
 * concatenating the IDs into a single comma‑delimited string.  You can
 * customise this list to include any other CoinGecko supported token IDs.
 */
const DEFAULT_IDS: string[] = [
  "bitcoin",
  "ethereum",
  "solana",
  "unicorn-fart-dust",
  "dogecoin",
  "pepe",
  "sui",
  "shiba-inu",
];

/**
 * Helper function to compute a simple momentum score for an asset.  The
 * riskBias parameter (0–1) determines the weight given to short‑term versus
 * medium‑term momentum.  A bias of 0 emphasises 24 hour changes; a bias of 1
 * emphasises 7 day changes.
 */
function calculateScore(
  asset: Asset,
  riskBias: number
): number {
  const change24h = asset.price_change_percentage_24h ?? 0;
  const change7d = asset.price_change_percentage_7d_in_currency ?? 0;
  // Base momentum component emphasises recent price changes.  The risk bias
  // controls how much weight to place on 24h versus 7d performance.
  const momentum = (1 - riskBias) * change24h + riskBias * change7d;
  // Sentiment component: a positive net sentiment (bullish minus bearish)
  // boosts the score while a negative net sentiment reduces it.  The
  // divisor scales the difference (0–100 range) down to a modest
  // contribution (±10).  If sentiment scores are undefined they are
  // treated as zero.
  const bullish = asset.bullishScore ?? 0;
  const bearish = asset.bearishScore ?? 0;
  const netSentiment = bullish - bearish;
  const sentimentComponent = netSentiment / 10; // yields roughly ±10
  // On‑chain component: more holders implies a broader holder base.  We
  // normalise by 10,000 to produce a value in the range 0–5 given our
  // stubbed holder counts (1k–51k).  If holders is undefined the
  // contribution is zero.  Liquidity could also be incorporated here but
  // we omit it to avoid overweighting one factor.
  const holders = asset.holders ?? 0;
  const onchainComponent = holders / 10000;
  return momentum + sentimentComponent + onchainComponent;
}

/**
 * The main component.  It fetches pricing data from our API route, allows the
 * user to adjust the scoring bias and filter tokens, and renders a sortable
 * table with a watchlist indicator.  The watchlist is stored in component
 * state and not persisted across reloads.
 */
export default function Home() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [riskBias, setRiskBias] = useState<number>(0.5);
  const [search, setSearch] = useState<string>("");
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  // Sorting state: which column is currently sorted and in which direction.
  // Default to descending by score to surface high momentum tokens.  The
  // sortField names correspond to keys on the asset object or derived
  // properties (e.g. "24h" maps to price_change_percentage_24h).
  const [sortField, setSortField] = useState<string>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
    "desc"
  );

  // Filter state: numeric ranges for price, 24h %, 7d %, volume and market cap.
  // Values are stored as strings for controlled inputs; empty string means no
  // filter applied.  Min and max values are inclusive when specified.
  const [filters, setFilters] = useState({
    minPrice: "",
    maxPrice: "",
    min24h: "",
    max24h: "",
    min7d: "",
    max7d: "",
    minVolume: "",
    minMarketCap: "",
    // Additional filters for new metrics.  These allow users to specify
    // minimum bullish sentiment, maximum bearish sentiment, minimum
    // liquidity and minimum holder counts.  Empty strings represent no
    // filter.
    minBullish: "",
    maxBearish: "",
    minLiquidity: "",
    minHolders: "",
  });

  // When searching, debounce API calls to avoid hitting rate limits.  This
  // ref stores the current timeout so that it can be cleared on subsequent
  // renders before scheduling a new request.  Without debouncing, each
  // keystroke would immediately trigger a network request which can easily
  // exceed the CoinGecko free API rate limits and result in 429 errors.
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Helper to load the default set of tokens defined in DEFAULT_IDS.
  async function loadDefault() {
    setLoading(true);
    try {
      const ids = DEFAULT_IDS.join(",");
      // Fetch price data for the default list of tokens.
      const priceRes = await fetch(`/api/prices?ids=${ids}`);
      const priceData: Asset[] = await priceRes.json();
      // If no data returned, exit early.
      if (!priceData || priceData.length === 0) {
        setAssets([]);
        return;
      }
      // Prepare comma‑delimited list of IDs for sentiment and on‑chain requests.
      const idStr = priceData.map((a) => a.id).join(",");
      // Fetch sentiment and on‑chain metrics concurrently.  These endpoints
      // return stubbed data for demonstration purposes but can be wired to
      // real providers in production.
      const [sentimentRes, onchainRes] = await Promise.all([
        fetch(`/api/sentiment?ids=${idStr}`),
        fetch(`/api/onchain?ids=${idStr}`),
      ]);
      const sentimentData: any[] = sentimentRes.ok ? await sentimentRes.json() : [];
      const onchainData: any[] = onchainRes.ok ? await onchainRes.json() : [];
      // Merge the additional metrics into the price data.  We create a
      // lookup table for faster ID‑based access.
      const sentimentMap: Record<string, any> = {};
      sentimentData.forEach((s) => {
        sentimentMap[s.id] = s;
      });
      const onchainMap: Record<string, any> = {};
      onchainData.forEach((o) => {
        onchainMap[o.id] = o;
      });
      const combined: Asset[] = priceData.map((asset) => {
        const extra: any = {};
        const s = sentimentMap[asset.id];
        if (s) {
          extra.bullishScore = s.bullishScore;
          extra.bearishScore = s.bearishScore;
          extra.mentionVolume = s.mentionVolume;
        }
        const o = onchainMap[asset.id];
        if (o) {
          extra.liquidity = o.liquidity;
          extra.holders = o.holders;
        }
        return { ...asset, ...extra };
      });
      setAssets(combined);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Fetch price data on mount by loading the default tokens.  We use
  // a dedicated helper so that the same logic can be reused when the
  // search query is cleared.
  useEffect(() => {
    loadDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the search term changes, either reload the default list (if the
  // search box is empty) or query the API for matching tokens.  The search
  // endpoint returns basic metadata; we then fetch price data for the top
  // matches to display.  Limiting the number of IDs helps stay within
  // reasonable API request sizes and rate limits.
  useEffect(() => {
    const term = search.trim().toLowerCase();
    // If the search box is empty, reload the default list immediately and
    // cancel any pending debounce.  Clearing the search should reset the
    // interface without delay.
    if (!term) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = undefined;
      }
      loadDefault();
      return;
    }

    // Cancel the previous scheduled search to avoid multiple overlapping
    // requests.  Each new keystroke resets the timer.
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?query=${encodeURIComponent(term)}`
        );
        const data = await res.json();
        if (data?.coins) {
          // Limit to 10 IDs to reduce the size of price queries and stay
          // within rate limits.  Fetching too many IDs at once increases
          // the likelihood of a 429 (Too Many Requests) response from
          // CoinGecko.
          const ids: string[] = data.coins.map((c: any) => c.id).slice(0, 10);
          if (ids.length > 0) {
            const priceRes = await fetch(
              `/api/prices?ids=${ids.join(",")}`
            );
              if (!priceRes.ok) {
                // If the price endpoint returns an error (e.g. 429 Too Many
                // Requests), log it and clear the results instead of throwing.
                console.error(
                  `Price fetch failed with status ${priceRes.status}`
                );
                setAssets([]);
              } else {
                const priceData: Asset[] = await priceRes.json();
                // After retrieving prices, fetch sentiment and on‑chain
                // metrics and merge them.  If either request fails, we
                // gracefully continue with whatever data is available.
                const idStr = priceData.map((p) => p.id).join(",");
                try {
                  const [sentRes, onRes] = await Promise.all([
                    fetch(`/api/sentiment?ids=${idStr}`),
                    fetch(`/api/onchain?ids=${idStr}`),
                  ]);
                  const sData: any[] = sentRes.ok ? await sentRes.json() : [];
                  const oData: any[] = onRes.ok ? await onRes.json() : [];
                  const sMap: Record<string, any> = {};
                  sData.forEach((s: any) => {
                    sMap[s.id] = s;
                  });
                  const oMap: Record<string, any> = {};
                  oData.forEach((o: any) => {
                    oMap[o.id] = o;
                  });
                  const combined: Asset[] = priceData.map((asset) => {
                    const extra: any = {};
                    const s = sMap[asset.id];
                    if (s) {
                      extra.bullishScore = s.bullishScore;
                      extra.bearishScore = s.bearishScore;
                      extra.mentionVolume = s.mentionVolume;
                    }
                    const o = oMap[asset.id];
                    if (o) {
                      extra.liquidity = o.liquidity;
                      extra.holders = o.holders;
                    }
                    return { ...asset, ...extra };
                  });
                  setAssets(combined);
                } catch (fetchErr) {
                  console.error(fetchErr);
                  // Even if merging fails, still set the price data so that
                  // the table is populated.
                  setAssets(priceData);
                }
              }
          } else {
            setAssets([]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 500); // 500ms debounce delay

    // Cleanup function to clear the timeout when the component unmounts or
    // before the next effect run.  This prevents attempting to update state
    // after the component has unmounted.
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /** Toggle watch status for a given asset id. */
  function toggleWatch(id: string) {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * Update the filter state for a given key.  Converts the input event's
   * value directly to a string; empty strings indicate no filter.  This
   * helper uses functional updates to avoid stale state issues.
   */
  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Handle sorting by a specific field.  Clicking on a column header will
   * toggle between ascending and descending order if that column is already
   * selected.  Selecting a new column defaults to descending order.
   */
  function handleSort(field: string) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

  // Prepare rows for display: apply search and numeric filters, compute score,
  // and apply sorting based on the selected column and direction.  The
  // watchlist still takes priority: watched items always appear at the top.
  const filtered: Asset[] = assets
    .filter((asset) => {
      // Text search filter: if a term is present, match name or symbol
      const term = search.toLowerCase().trim();
      if (term) {
        const matchesName = asset.name.toLowerCase().includes(term);
        const matchesSymbol = asset.symbol.toLowerCase().includes(term);
        if (!matchesName && !matchesSymbol) return false;
      }
      // Numeric filters: parse values; skip if empty or NaN
      const {
        minPrice,
        maxPrice,
        min24h,
        max24h,
        min7d,
        max7d,
        minVolume,
        minMarketCap,
        minBullish,
        maxBearish,
        minLiquidity,
        minHolders,
      } = filters;
      const price = asset.current_price ?? 0;
      const change24h = asset.price_change_percentage_24h ?? 0;
      const change7d = asset.price_change_percentage_7d_in_currency ?? 0;
      const volume = asset.total_volume ?? 0;
      const mcap = asset.market_cap ?? 0;
      const bullish = asset.bullishScore ?? 0;
      const bearish = asset.bearishScore ?? 0;
      const liquidity = asset.liquidity ?? 0;
      const holders = asset.holders ?? 0;
      // Price range
      if (minPrice !== "" && !isNaN(parseFloat(minPrice)) && price < parseFloat(minPrice)) {
        return false;
      }
      if (maxPrice !== "" && !isNaN(parseFloat(maxPrice)) && price > parseFloat(maxPrice)) {
        return false;
      }
      // 24h change range
      if (min24h !== "" && !isNaN(parseFloat(min24h)) && change24h < parseFloat(min24h)) {
        return false;
      }
      if (max24h !== "" && !isNaN(parseFloat(max24h)) && change24h > parseFloat(max24h)) {
        return false;
      }
      // 7d change range
      if (min7d !== "" && !isNaN(parseFloat(min7d)) && change7d < parseFloat(min7d)) {
        return false;
      }
      if (max7d !== "" && !isNaN(parseFloat(max7d)) && change7d > parseFloat(max7d)) {
        return false;
      }
      // Volume minimum
      if (minVolume !== "" && !isNaN(parseFloat(minVolume)) && volume < parseFloat(minVolume)) {
        return false;
      }
      // Market cap minimum
      if (minMarketCap !== "" && !isNaN(parseFloat(minMarketCap)) && mcap < parseFloat(minMarketCap)) {
        return false;
      }
      // Sentiment minimum: require bullish sentiment above threshold
      if (minBullish !== "" && !isNaN(parseFloat(minBullish)) && bullish < parseFloat(minBullish)) {
        return false;
      }
      // Sentiment maximum: require bearish sentiment below threshold
      if (maxBearish !== "" && !isNaN(parseFloat(maxBearish)) && bearish > parseFloat(maxBearish)) {
        return false;
      }
      // Liquidity minimum
      if (minLiquidity !== "" && !isNaN(parseFloat(minLiquidity)) && liquidity < parseFloat(minLiquidity)) {
        return false;
      }
      // Holders minimum
      if (minHolders !== "" && !isNaN(parseFloat(minHolders)) && holders < parseFloat(minHolders)) {
        return false;
      }
      return true;
    })
    .map((asset) => {
      const score = calculateScore(asset, riskBias);
      return { ...asset, score };
    })
    .sort((a, b) => {
      // Always show watched items first
      const aWatched = watchlist.has(a.id);
      const bWatched = watchlist.has(b.id);
      if (aWatched && !bWatched) return -1;
      if (!aWatched && bWatched) return 1;
      // Determine multiplier for ascending/descending
      const multiplier = sortDirection === "asc" ? 1 : -1;
      // Extract values based on sortField
      const getValue = (item: Asset) => {
        switch (sortField) {
          case "price":
            return item.current_price ?? 0;
          case "24h":
            return item.price_change_percentage_24h ?? 0;
          case "7d":
            return item.price_change_percentage_7d_in_currency ?? 0;
          case "volume":
            return item.total_volume ?? 0;
          case "market_cap":
            return item.market_cap ?? 0;
          case "bullish":
            return item.bullishScore ?? 0;
          case "bearish":
            return item.bearishScore ?? 0;
          case "mentions":
            return item.mentionVolume ?? 0;
          case "liquidity":
            return item.liquidity ?? 0;
          case "holders":
            return item.holders ?? 0;
          case "name":
            return item.name.toLowerCase();
          case "score":
          default:
            return item.score ?? 0;
        }
      };
      const aVal = getValue(a);
      const bVal = getValue(b);
      // Alphabetic comparison for names
      if (sortField === "name") {
        return multiplier * (aVal as string).localeCompare(bVal as string);
      }
      // Numeric comparison
      return multiplier * ((aVal as number) - (bVal as number));
    });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 p-6 sm:p-10">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Crypto Moonshot Screener</h1>
          <p className="mt-1 text-sm text-gray-600">
            Explore short‑term momentum across a curated set of tokens. Adjust
            the <strong>Risk Bias</strong> slider to tilt scores toward 24h
            momentum (left) or 7d momentum (right).
          </p>
          {/*
            Provide a brief description of what this dashboard does and how to use it.
            This text appears below the title and risk bias explanation to orient
            new users.  It explains that the screener surfaces potential
            "moonshots" based on price momentum, community sentiment and on‑chain
            metrics and encourages users to experiment with the filters, sorting
            and watchlist.
          */}
          <p className="mt-2 text-sm text-gray-600">
            This screener ranks cryptocurrencies by combining recent price
            performance, social sentiment and on‑chain activity. Use the filters
            below to narrow by price, percentage change, volume, sentiment,
            liquidity or holder count. Click column headers to sort and click
            the star to add tokens to your personal watchlist. The composite
            <em>score</em> is a heuristic—invest at your own risk!
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <label
            className="text-sm font-medium whitespace-nowrap"
            title="Use this slider to emphasise 24h momentum (left) or 7d momentum (right) when computing the score."
          >
            Risk Bias: {riskBias.toFixed(1)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={riskBias}
            onChange={(e) => setRiskBias(parseFloat(e.target.value))}
            className="w-full sm:w-40"
            title="Drag to adjust the weighting between short‑term (24h) and medium‑term (7d) price changes."
          />
          <input
            type="text"
            placeholder="Search by name or symbol"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
            title="Type to search for tokens by name or symbol."
          />
        </div>
      </header>
      {loading ? (
        <p>Loading data…</p>
      ) : (
        <div className="overflow-x-auto">
          {/* Filter controls */}
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Price range filters */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets priced above this amount in USD."
              >
                Min Price
              </label
              >
              <input
                type="number"
                value={filters.minPrice}
                onChange={(e) => updateFilter("minPrice", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder="0"
                step="any"
                title="Show only assets priced above this amount in USD."
              />
            </div>
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets priced below this amount in USD."
              >
                Max Price
              </label>
              <input
                type="number"
                value={filters.maxPrice}
                onChange={(e) => updateFilter("maxPrice", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* 24h % filters */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with a 24h percentage change greater than or equal to this value."
              >
                Min 24h %
              </label>
              <input
                type="number"
                value={filters.min24h}
                onChange={(e) => updateFilter("min24h", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with a 24h percentage change less than or equal to this value."
              >
                Max 24h %
              </label>
              <input
                type="number"
                value={filters.max24h}
                onChange={(e) => updateFilter("max24h", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* 7d % filters */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with a 7 day percentage change greater than or equal to this value."
              >
                Min 7d %
              </label>
              <input
                type="number"
                value={filters.min7d}
                onChange={(e) => updateFilter("min7d", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with a 7 day percentage change less than or equal to this value."
              >
                Max 7d %
              </label>
              <input
                type="number"
                value={filters.max7d}
                onChange={(e) => updateFilter("max7d", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Volume minimum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets whose 24h trading volume exceeds this amount."
              >
                Min Volume
              </label>
              <input
                type="number"
                value={filters.minVolume}
                onChange={(e) => updateFilter("minVolume", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Market cap minimum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with market capitalisation above this amount."
              >
                Min Market Cap
              </label>
              <input
                type="number"
                value={filters.minMarketCap}
                onChange={(e) => updateFilter("minMarketCap", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Bullish sentiment minimum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with bullish sentiment at or above this threshold (0–100 scale)."
              >
                Min Bullish
              </label>
              <input
                type="number"
                value={filters.minBullish}
                onChange={(e) => updateFilter("minBullish", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Bearish sentiment maximum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with bearish sentiment at or below this threshold (0–100 scale)."
              >
                Max Bearish
              </label>
              <input
                type="number"
                value={filters.maxBearish}
                onChange={(e) => updateFilter("maxBearish", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Liquidity minimum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets with at least this amount of liquidity locked in pools (USD)."
              >
                Min Liquidity
              </label>
              <input
                type="number"
                value={filters.minLiquidity}
                onChange={(e) => updateFilter("minLiquidity", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
            {/* Holders minimum filter */}
            <div>
              <label
                className="block text-xs text-gray-600 mb-1"
                title="Show only assets held by at least this many unique wallets."
              >
                Min Holders
              </label>
              <input
                type="number"
                value={filters.minHolders}
                onChange={(e) => updateFilter("minHolders", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder=""
                step="any"
              />
            </div>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  title="Click to add or remove an asset from your watchlist."
                >
                  Watch
                </th>
                {/* Asset column header with sort by name */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("name")}
                  title="Asset name and symbol"
                >
                  Asset
                  {sortField === "name" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Price column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("price")}
                  title="Current price in US dollars"
                >
                  Price (USD)
                  {sortField === "price" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* 24h % column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("24h")}
                  title="Price percentage change over the last 24 hours"
                >
                  24h %
                  {sortField === "24h" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* 7d % column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("7d")}
                  title="Price percentage change over the last 7 days"
                >
                  7d %
                  {sortField === "7d" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Volume column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("volume")}
                  title="Total trading volume in the past 24 hours"
                >
                  Volume
                  {sortField === "volume" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Market cap column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("market_cap")}
                  title="Market capitalisation of the token"
                >
                  Mkt Cap
                  {sortField === "market_cap" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Bullish sentiment column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("bullish")}
                  title="Bullish sentiment score (0–100 reflecting positive social posts)"
                >
                  Bullish
                  {sortField === "bullish" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Bearish sentiment column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("bearish")}
                  title="Bearish sentiment score (0–100 reflecting negative social posts)"
                >
                  Bearish
                  {sortField === "bearish" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Mention volume column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("mentions")}
                  title="Number of social media mentions or posts"
                >
                  Mentions
                  {sortField === "mentions" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Liquidity column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("liquidity")}
                  title="Estimated liquidity locked in DeFi pools (USD)"
                >
                  Liquidity
                  {sortField === "liquidity" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Holders column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("holders")}
                  title="Number of unique wallets holding the asset"
                >
                  Holders
                  {sortField === "holders" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Score column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("score")}
                  title="Composite score combining momentum, sentiment and on‑chain metrics"
                >
                  Score
                  {sortField === "score" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map((asset) => (
                <tr key={asset.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleWatch(asset.id)}
                      className="text-xl focus:outline-none"
                      aria-label={
                        watchlist.has(asset.id)
                          ? `Remove ${asset.name} from watchlist`
                          : `Add ${asset.name} to watchlist`
                      }
                    title={
                      watchlist.has(asset.id)
                        ? `Remove ${asset.name} from your watchlist`
                        : `Add ${asset.name} to your watchlist`
                    }
                    >
                      {watchlist.has(asset.id) ? "⭐" : "☆"}
                    </button>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="font-medium text-gray-900">
                      {asset.name}
                    </span>{" "}
                    <span className="text-gray-500 uppercase">
                      ({asset.symbol})
                    </span>
                  </td>
                  {/* Price cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    ${
                      asset.current_price?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      }) ?? "—"
                    }
                  </td>
                  {/* 24h % cell */}
                  <td
                    className={`px-4 py-2 whitespace-nowrap ${
                      (asset.price_change_percentage_24h ?? 0) >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {asset.price_change_percentage_24h?.toFixed(2) ?? "–"}%
                  </td>
                  {/* 7d % cell */}
                  <td
                    className={`px-4 py-2 whitespace-nowrap ${
                      (asset.price_change_percentage_7d_in_currency ?? 0) >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {asset.price_change_percentage_7d_in_currency?.toFixed(2) ??
                      "–"}
                    %
                  </td>
                  {/* Volume cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.total_volume !== undefined
                      ? asset.total_volume.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </td>
                  {/* Market cap cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.market_cap !== undefined
                      ? asset.market_cap.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </td>
                  {/* Bullish score cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.bullishScore !== undefined
                      ? asset.bullishScore.toFixed(0)
                      : "—"}
                  </td>
                  {/* Bearish score cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.bearishScore !== undefined
                      ? asset.bearishScore.toFixed(0)
                      : "—"}
                  </td>
                    {/* Mention volume cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.mentionVolume !== undefined
                      ? asset.mentionVolume.toLocaleString()
                      : "—"}
                  </td>
                  {/* Liquidity cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.liquidity !== undefined
                      ? `$${asset.liquidity.toLocaleString()}`
                      : "—"}
                  </td>
                  {/* Holders cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.holders !== undefined
                      ? asset.holders.toLocaleString()
                      : "—"}
                  </td>
                  {/* Score cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.score !== undefined
                      ? asset.score.toFixed(2)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}