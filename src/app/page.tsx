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
  // Weight the momentum metrics according to the risk bias.
  return (1 - riskBias) * change24h + riskBias * change7d;
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
      const res = await fetch(`/api/prices?ids=${ids}`);
      const data: Asset[] = await res.json();
      setAssets(data);
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
              setAssets(priceData);
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
      } = filters;
      const price = asset.current_price ?? 0;
      const change24h = asset.price_change_percentage_24h ?? 0;
      const change7d = asset.price_change_percentage_7d_in_currency ?? 0;
      const volume = asset.total_volume ?? 0;
      const mcap = asset.market_cap ?? 0;
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
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <label className="text-sm font-medium whitespace-nowrap">
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
          />
          <input
            type="text"
            placeholder="Search by name or symbol"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
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
              <label className="block text-xs text-gray-600 mb-1">Min Price</label>
              <input
                type="number"
                value={filters.minPrice}
                onChange={(e) => updateFilter("minPrice", e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                placeholder="0"
                step="any"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Max Price</label>
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
              <label className="block text-xs text-gray-600 mb-1">Min 24h %</label>
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
              <label className="block text-xs text-gray-600 mb-1">Max 24h %</label>
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
              <label className="block text-xs text-gray-600 mb-1">Min 7d %</label>
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
              <label className="block text-xs text-gray-600 mb-1">Max 7d %</label>
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
              <label className="block text-xs text-gray-600 mb-1">Min Volume</label>
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
              <label className="block text-xs text-gray-600 mb-1">Min Market Cap</label>
              <input
                type="number"
                value={filters.minMarketCap}
                onChange={(e) => updateFilter("minMarketCap", e.target.value)}
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
                >
                  Watch
                </th>
                {/* Asset column header with sort by name */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("name")}
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
                >
                  Market Cap
                  {sortField === "market_cap" && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
                {/* Score column header */}
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("score")}
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
                  {/* Score cell */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {asset.score?.toFixed(2)}
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