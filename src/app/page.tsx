"use client";

import { useEffect, useState } from "react";

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

  // Fetch price data on mount.  We construct the query string from
  // DEFAULT_IDS to keep the call generic and easily configurable.
  useEffect(() => {
    async function fetchData() {
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
    fetchData();
  }, []);

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

  // Prepare rows for display: apply search filter, compute score and sort.
  const filtered: Asset[] = assets
    .filter((asset) => {
      const term = search.toLowerCase().trim();
      if (!term) return true;
      return (
        asset.name.toLowerCase().includes(term) ||
        asset.symbol.toLowerCase().includes(term)
      );
    })
    .map((asset) => {
      const score = calculateScore(asset, riskBias);
      return { ...asset, score };
    })
    .sort((a, b) => {
      const aWatched = watchlist.has(a.id);
      const bWatched = watchlist.has(b.id);
      if (aWatched && !bWatched) return -1;
      if (!aWatched && bWatched) return 1;
      // Secondary sort: descending by score.
      return (b.score ?? 0) - (a.score ?? 0);
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
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Watch
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Asset
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Price (USD)
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  24h %
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  7d %
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Score
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
                  <td className="px-4 py-2 whitespace-nowrap">
                    ${
                      asset.current_price?.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      }) ?? "—"
                    }
                  </td>
                  <td
                    className={`px-4 py-2 whitespace-nowrap ${
                      (asset.price_change_percentage_24h ?? 0) >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {asset.price_change_percentage_24h?.toFixed(2) ?? "–"}%
                  </td>
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