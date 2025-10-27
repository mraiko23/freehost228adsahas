// Poller: check STOCK API every 2 seconds; when updatedAt changes, call worker /force-check
// Usage: set WORKER_URL and optionally STOCK_API_URL env vars, then `node poller.js`
// WARNING: hitting APIs every 2s may be heavy; this script only calls /force-check when updatedAt changes.

const fetch = require('node-fetch');

const WORKER_URL = process.env.WORKER_URL || 'https://proud-star-083b.karovakorovnin.workers.dev';
const STOCK_API_URL = process.env.STOCK_API_URL || 'https://plantsvsbrainrotsstocktracker.com/api/stock?since=0';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS, 10) || 2000; // 2 seconds default

let lastUpdatedAt = null;
let inFlight = false;

async function fetchStockOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(STOCK_API_URL, { timeout: 5000 });
    if (!res.ok) {
      console.warn(new Date().toISOString(), 'stock api returned', res.status);
      inFlight = false;
      return;
    }
    const data = await res.json();
    const updatedAt = data && data.updatedAt ? Number(data.updatedAt) : null;

    if (updatedAt && lastUpdatedAt && updatedAt !== lastUpdatedAt) {
      console.log(new Date().toISOString(), 'Detected updatedAt change:', lastUpdatedAt, '->', updatedAt);
      // call worker /force-check to trigger notification logic
      try {
        const r = await fetch(`${WORKER_URL}/force-check`);
        console.log(new Date().toISOString(), '/force-check status:', r.status);
      } catch (err) {
        console.error(new Date().toISOString(), 'Error calling /force-check:', err.message);
      }
    }

    // initialize or update lastUpdatedAt
    if (updatedAt && lastUpdatedAt === null) {
      console.log(new Date().toISOString(), 'Initial updatedAt set to', updatedAt);
    }
    if (updatedAt) lastUpdatedAt = updatedAt;
  } catch (err) {
    console.error(new Date().toISOString(), 'Error fetching stock API:', err.message);
  } finally {
    inFlight = false;
  }
}

console.log('Starting poller: checking', STOCK_API_URL, 'every', INTERVAL_MS, 'ms; worker at', WORKER_URL);
// run immediately then on interval
fetchStockOnce();
setInterval(fetchStockOnce, INTERVAL_MS);


