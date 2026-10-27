/** Where the scheduled GitHub Action publishes latest.json and analysis.json (the `data` branch). */
export const SNAPSHOT_BASE_URL =
  process.env.SNAPSHOT_BASE_URL ?? "https://raw.githubusercontent.com/lukeyin08/prediction-market-scanner/data";
